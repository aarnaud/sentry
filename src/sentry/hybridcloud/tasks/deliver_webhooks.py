import datetime
import logging

import sentry_sdk
from django.db.models import Min, Subquery
from django.utils import timezone
from requests import Response
from requests.models import HTTPError
from rest_framework import status

from sentry.exceptions import RestrictedIPAddress
from sentry.hybridcloud.models.webhookpayload import BACKOFF_INTERVAL, MAX_ATTEMPTS, WebhookPayload
from sentry.shared_integrations.exceptions import (
    ApiConflictError,
    ApiConnectionResetError,
    ApiError,
    ApiHostError,
    ApiTimeoutError,
)
from sentry.silo.base import SiloMode
from sentry.silo.client import RegionSiloClient, SiloClientError
from sentry.tasks.base import instrumented_task
from sentry.types.region import get_region_by_name
from sentry.utils import json, metrics

logger = logging.getLogger(__name__)

MAX_MAILBOX_DRAIN = 100
"""
The maximum number of records that will be delivered in a scheduled delivery

There is a balance here between clearing big backlogs and having races when
a batch is slow but not timeout slow.
"""

BATCH_SCHEDULE_OFFSET = datetime.timedelta(minutes=BACKOFF_INTERVAL)
"""
The time that batches are scheduled into the future when work starts.
Spacing batches out helps minimize competitive races when delivery is slow
but not at the timeout threshold
"""

BATCH_SIZE = 1000
"""The number of mailboxes that will have messages scheduled each cycle"""


class DeliveryFailed(Exception):
    """
    Used to signal an expected delivery failure.
    """

    pass


@instrumented_task(
    name="sentry.hybridcloud.tasks.deliver_webhooks.schedule_webhook_delivery",
    queue="webhook.control",
    silo_mode=SiloMode.CONTROL,
)
def schedule_webhook_delivery(**kwargs) -> None:
    """
    Find mailboxes that contain undelivered webhooks that were scheduled
    to be delivered now or in the past.

    Triggered frequently by celery beat.
    """
    # The double call to .values() ensures that the group by includes mailbox_nam
    # but only id_min is selected
    head_of_line = (
        WebhookPayload.objects.all()
        .values("mailbox_name")
        .annotate(id_min=Min("id"))
        .values("id_min")
    )
    # Get any heads that are scheduled to run
    scheduled_mailboxes = WebhookPayload.objects.filter(
        schedule_for__lte=timezone.now(),
        id__in=Subquery(head_of_line),
    ).values("id", "mailbox_name")

    metrics.distribution(
        "hybridcloud.schedule_webhook_delivery.mailbox_count", scheduled_mailboxes.count()
    )
    for record in scheduled_mailboxes[:BATCH_SIZE]:
        # Reschedule the records that we will attempt to deliver next.
        # We reschedule in an attempt to minimize races for potentially in-flight batches.
        mailbox_batch = (
            WebhookPayload.objects.filter(id__gte=record["id"], mailbox_name=record["mailbox_name"])
            .order_by("id")
            .values("id")[:MAX_MAILBOX_DRAIN]
        )
        WebhookPayload.objects.filter(id__in=Subquery(mailbox_batch)).update(
            schedule_for=timezone.now() + BATCH_SCHEDULE_OFFSET
        )

        drain_mailbox.delay(record["id"])


@instrumented_task(
    name="sentry.hybridcloud.tasks.deliver_webhooks.drain_mailbox",
    queue="webhook.control",
    silo_mode=SiloMode.CONTROL,
)
def drain_mailbox(payload_id: int) -> None:
    """
    Attempt deliver up to 50 webhooks from the mailbox that `id` is from.

    Messages will be delivered in order until one fails or 50 are delivered.
    Once messages have successfully been delivered or discarded, they are deleted.
    """
    try:
        payload = WebhookPayload.objects.get(id=payload_id)
    except WebhookPayload.DoesNotExist:
        # We could have hit a race condition. Since we've lost already return
        # and let the other process continue, or a future process.
        metrics.incr("hybridcloud.deliver_webhooks.delivery", tags={"outcome": "race"})
        logger.info(
            "deliver_webhook.potential_race",
            extra={
                "id": payload_id,
            },
        )
        return

    # Drain up to a max number of records. This helps ensure that one slow mailbox doesn't
    # cause backups for other mailboxes
    query = WebhookPayload.objects.filter(
        id__gte=payload.id, mailbox_name=payload.mailbox_name
    ).order_by("id")
    for record in query[:MAX_MAILBOX_DRAIN]:
        try:
            deliver_message(record)
        except DeliveryFailed:
            metrics.incr("hybridcloud.deliver_webhooks.delivery", tags={"outcome": "retry"})
            return


def deliver_message(payload: WebhookPayload) -> None:
    """Deliver a message if it still has delivery attempts remaining"""
    if payload.attempts >= MAX_ATTEMPTS:
        payload.delete()

        metrics.incr("hybridcloud.deliver_webhooks.delivery", tags={"outcome": "attempts_exceed"})
        logger.info(
            "deliver_webhook.discard", extra={"id": payload.id, "attempts": payload.attempts}
        )
        return

    payload.schedule_next_attempt()
    perform_request(payload)
    payload.delete()

    metrics.incr("hybridcloud.deliver_webhooks.delivery", tags={"outcome": "ok"})
    metrics.distribution("hybridcloud.deliver_webhooks.attempts", payload.attempts)


def perform_request(payload: WebhookPayload) -> None:
    logging_context: dict[str, str | int] = {
        "payload_id": payload.id,
        "mailbox_name": payload.mailbox_name,
        "attempt": payload.attempts,
    }
    region = get_region_by_name(name=payload.region_name)

    try:
        client = RegionSiloClient(region=region)
        with metrics.timer(
            "hybridcloud.deliver_webhooks.send_request",
            tags={"destination_region": region.name},
        ):
            logging_context["region"] = region.name
            logging_context["request_method"] = payload.request_method
            logging_context["request_path"] = payload.request_path

            headers = json.loads(payload.request_headers)
            response = client.request(
                method=payload.request_method,
                path=payload.request_path,
                headers=headers,
                # We need to send the body as raw bytes to avoid interfering with webhook signatures
                data=payload.request_body.encode("utf-8"),
                json=False,
            )
        logger.info(
            "deliver_webhooks.success",
            extra={
                "status": getattr(
                    response, "status_code", 204
                ),  # Request returns empty dict instead of a response object when the code is a 204
                **logging_context,
            },
        )
    except ApiHostError as err:
        metrics.incr(
            "hybridcloud.deliver_webhooks.failure",
            tags={"reason": "host_error", "destination_region": region.name},
        )
        with sentry_sdk.push_scope() as scope:
            scope.set_context(
                "region",
                {
                    "name": region.name,
                    "id": region.category,
                    "address": region.address,
                },
            )
            err_cause = err.__cause__
            if err_cause is not None and isinstance(err_cause, RestrictedIPAddress):
                # Region silos that are IP address restricted are actionable.
                silo_client_err = SiloClientError("Region silo is IP address restricted")
                silo_client_err.__cause__ = err
                sentry_sdk.capture_exception(silo_client_err)
                raise DeliveryFailed()

            sentry_sdk.capture_exception(err)
        logger.warning("deliver_webhooks.host_error", extra={"error": str(err), **logging_context})
        raise DeliveryFailed() from err
    except ApiConflictError as err:
        metrics.incr(
            "hybridcloud.deliver_webhooks.failure",
            tags={"reason": "conflict", "destination_region": region.name},
        )
        logger.warning(
            "deliver_webhooks.conflict_occurred",
            extra={"conflict_text": err.text, **logging_context},
        )
        # We don't retry conflicts as those are explicit failure code to drop webhook.
    except (ApiTimeoutError, ApiConnectionResetError) as err:
        metrics.incr(
            "hybridcloud.deliver_webhooks.failure",
            tags={"reason": "timeout_reset", "destination_region": region.name},
        )
        logger.warning("deliver_webhooks.timeout_error", extra=logging_context)
        raise DeliveryFailed() from err
    except ApiError as err:
        err_cause = err.__cause__
        response_code = -1
        if isinstance(err_cause, HTTPError):
            orig_response: Response | None = err_cause.response
            if orig_response is not None:
                response_code = orig_response.status_code

            # We need to retry on region 500s
            if status.HTTP_500_INTERNAL_SERVER_ERROR <= response_code < 600:
                raise DeliveryFailed() from err

            # We don't retry 404 or 400 as they will fail again.
            if response_code in {404, 400, 401}:
                reason = "not_found"
                if response_code == 400:
                    reason = "bad_request"
                elif response_code == 401:
                    reason = "unauthorized"
                metrics.incr(
                    "hybridcloud.deliver_webhooks.failure",
                    tags={"reason": reason, "destination_region": region.name},
                )
                logger.info(
                    "deliver_webhooks.40x_error",
                    extra={"reason": reason, **logging_context},
                )
                return

        # Other ApiErrors should be retried
        metrics.incr(
            "hybridcloud.deliver_webhooks.failure",
            tags={"reason": "api_error", "destination_region": region.name},
        )
        logger.warning(
            "deliver_webhooks.api_error",
            extra={"error": str(err), "response_code": response_code, **logging_context},
        )
        raise DeliveryFailed() from err
