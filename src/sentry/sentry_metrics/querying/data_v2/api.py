from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from snuba_sdk import MetricsQuery, MetricsScope, Rollup

from sentry.models.environment import Environment
from sentry.models.organization import Organization
from sentry.models.project import Project
from sentry.sentry_metrics.querying.data_v2.execution import QueryExecutor
from sentry.sentry_metrics.querying.data_v2.parsing import QueryParser
from sentry.sentry_metrics.querying.data_v2.plan import MetricsQueriesPlan
from sentry.sentry_metrics.querying.data_v2.transformation import QueryTransformer
from sentry.utils import metrics


def _time_equal_within_bound(time_1: datetime, time_2: datetime, bound: timedelta) -> bool:
    return time_2 - bound <= time_1 <= time_2 + bound


def _within_last_7_days(start: datetime, end: datetime) -> bool:
    # Get current datetime in UTC
    current_datetime_utc = datetime.now(timezone.utc)

    # Calculate datetime 7 days ago in UTC
    seven_days_ago_utc = current_datetime_utc - timedelta(days=7)

    # Normalize start and end datetimes to UTC
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)

    return (
        _time_equal_within_bound(start_utc, seven_days_ago_utc, timedelta(minutes=5))
        and _time_equal_within_bound(end_utc, current_datetime_utc, timedelta(minutes=5))
    ) or (
        _time_equal_within_bound(end_utc, current_datetime_utc, timedelta(minutes=5))
        and (end - start).days <= 7
    )


def run_metrics_queries_plan(
    metrics_queries_plan: MetricsQueriesPlan,
    start: datetime,
    end: datetime,
    interval: int,
    organization: Organization,
    projects: Sequence[Project],
    environments: Sequence[Environment],
    referrer: str,
) -> Mapping[str, Any]:
    metrics.incr(
        key="ddm.metrics_api.queried_time_range",
        amount=1,
        tags={"within_last_7_days": _within_last_7_days(start, end)},
    )

    # For now, if the query plan is empty, we return an empty dictionary. In the future, we might want to default
    # to a better data type.
    if metrics_queries_plan.is_empty():
        return {}

    # We build the basic query that contains the metadata which will be shared across all queries.
    base_query = MetricsQuery(
        start=start,
        end=end,
        scope=MetricsScope(
            org_ids=[organization.id],
            project_ids=[project.id for project in projects],
        ),
    )

    # We prepare the executor, that will be responsible for scheduling the execution of multiple queries.
    executor = QueryExecutor(organization=organization, projects=projects, referrer=referrer)

    # We parse the query plan and obtain a series of queries.
    parser = QueryParser(
        projects=projects, environments=environments, metrics_queries_plan=metrics_queries_plan
    )

    for query_expression, query_order, query_limit in parser.generate_queries():
        query = base_query.set_query(query_expression).set_rollup(Rollup(interval=interval))
        executor.schedule(query=query, order=query_order, limit=query_limit)

    with metrics.timer(key="ddm.metrics_api.metrics_queries_plan.execution_time"):
        # Iterating over each result.
        results = executor.execute()

    # We transform the result into a custom format which for now it's statically defined.
    transformer = QueryTransformer(results)
    return transformer.transform()
