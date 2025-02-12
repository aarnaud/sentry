import {useMemo} from 'react';
import styled from '@emotion/styled';

import {navigateTo} from 'sentry/actionCreators/navigation';
import {Button} from 'sentry/components/button';
import type {MenuItemProps} from 'sentry/components/dropdownMenu';
import {DropdownMenu} from 'sentry/components/dropdownMenu';
import {IconAdd, IconClose, IconEllipsis, IconSettings, IconSiren} from 'sentry/icons';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import {isCustomMetric} from 'sentry/utils/metrics';
import type {MetricsQuery} from 'sentry/utils/metrics/types';
import useOrganization from 'sentry/utils/useOrganization';
import usePageFilters from 'sentry/utils/usePageFilters';
import useRouter from 'sentry/utils/useRouter';
import {getCreateAlert} from 'sentry/views/ddm/metricQueryContextMenu';
import {Query} from 'sentry/views/ddm/queries';

export function Queries({metricWidgetQueries, handleChange, addQuery, removeQuery}) {
  const {selection} = usePageFilters();

  return (
    <QueriesWrapper>
      {metricWidgetQueries.map((query, index) => (
        <Query
          key={index}
          widget={query}
          projects={selection.projects}
          onChange={data => handleChange(data, index)}
          contextMenu={
            <ContextMenu
              removeQuery={removeQuery}
              queryIndex={index}
              canRemoveQuery={metricWidgetQueries.length > 1}
              metricsQuery={query}
            />
          }
        />
      ))}
      <Button size="sm" icon={<IconAdd isCircled />} onClick={addQuery}>
        {t('Add query')}
      </Button>
    </QueriesWrapper>
  );
}

function ContextMenu({
  metricsQuery,
  removeQuery,
  canRemoveQuery,
  queryIndex,
}: {
  canRemoveQuery: boolean;
  metricsQuery: MetricsQuery;
  queryIndex: number;
  removeQuery: (index: number) => void;
}) {
  const organization = useOrganization();
  const router = useRouter();

  const createAlert = useMemo(
    () => getCreateAlert(organization, metricsQuery),
    [metricsQuery, organization]
  );

  const items = useMemo<MenuItemProps[]>(() => {
    const customMetric = !isCustomMetric({mri: metricsQuery.mri});
    const addAlertItem = {
      leadingItems: [<IconSiren key="icon" />],
      key: 'add-alert',
      label: t('Create Alert'),
      disabled: !createAlert,
      onAction: () => {
        createAlert?.();
      },
    };
    const removeQueryItem = {
      leadingItems: [<IconClose key="icon" />],
      key: 'delete',
      label: t('Remove Query'),
      disabled: !canRemoveQuery,
      onAction: () => {
        removeQuery(queryIndex);
      },
    };
    const settingsItem = {
      leadingItems: [<IconSettings key="icon" />],
      key: 'settings',
      label: t('Metric Settings'),
      disabled: !customMetric,
      onAction: () => {
        navigateTo(
          `/settings/projects/:projectId/metrics/${encodeURIComponent(metricsQuery.mri)}`,
          router
        );
      },
    };

    return customMetric
      ? [addAlertItem, removeQueryItem, settingsItem]
      : [addAlertItem, removeQueryItem];
  }, [createAlert, metricsQuery.mri, removeQuery, canRemoveQuery, queryIndex, router]);

  return (
    <DropdownMenu
      items={items}
      triggerProps={{
        'aria-label': t('Widget actions'),
        size: 'md',
        showChevron: false,
        icon: <IconEllipsis direction="down" size="sm" />,
      }}
      position="bottom-end"
    />
  );
}

const QueriesWrapper = styled('div')`
  padding-bottom: ${space(2)};
`;
