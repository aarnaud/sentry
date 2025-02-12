import {useCallback, useLayoutEffect, useMemo} from 'react';
import styled from '@emotion/styled';
import * as echarts from 'echarts/core';

import {space} from 'sentry/styles/space';
import {getMetricsCorrelationSpanUrl} from 'sentry/utils/metrics';
import {MetricQueryType, type MetricWidgetQueryParams} from 'sentry/utils/metrics/types';
import type {MetricsQueryApiQueryParams} from 'sentry/utils/metrics/useMetricsQuery';
import useOrganization from 'sentry/utils/useOrganization';
import usePageFilters from 'sentry/utils/usePageFilters';
import useProjects from 'sentry/utils/useProjects';
import useRouter from 'sentry/utils/useRouter';
import {DDM_CHART_GROUP, MIN_WIDGET_WIDTH} from 'sentry/views/ddm/constants';
import {useDDMContext} from 'sentry/views/ddm/context';
import {getQuerySymbol} from 'sentry/views/ddm/querySymbol';
import {useGetCachedChartPalette} from 'sentry/views/ddm/utils/metricsChartPalette';

import type {Sample} from './widget';
import {MetricWidget} from './widget';

function widgetToQuery(
  widget: MetricWidgetQueryParams,
  queryLookup: Map<string, any>,
  isQueryOnly = false
): MetricsQueryApiQueryParams {
  return widget.type === MetricQueryType.FORMULA
    ? {
        name: getQuerySymbol(widget.id),
        // TODO(aknaus): Properly parse formulas to format identifiers
        // This solution is limited to single character identifiers
        formula: widget.formula
          .split('')
          .map(char => (queryLookup.has(char) ? `$${char}` : char))
          .join(''),
      }
    : {
        name: getQuerySymbol(widget.id),
        mri: widget.mri,
        op: widget.op,
        groupBy: widget.groupBy,
        query: widget.query,
        isQueryOnly: isQueryOnly,
      };
}

export function MetricScratchpad() {
  const {
    setSelectedWidgetIndex,
    selectedWidgetIndex,
    widgets,
    updateWidget,
    showQuerySymbols,
    highlightedSampleId,
    focusArea,
    isMultiChartMode,
  } = useDDMContext();
  const {selection} = usePageFilters();

  const router = useRouter();
  const organization = useOrganization();
  const {projects} = useProjects();
  const getChartPalette = useGetCachedChartPalette();

  // Make sure all charts are connected to the same group whenever the widgets definition changes
  useLayoutEffect(() => {
    echarts.connect(DDM_CHART_GROUP);
  }, [widgets]);

  const handleChange = useCallback(
    (index: number, widget: Partial<MetricWidgetQueryParams>) => {
      updateWidget(index, widget);
    },
    [updateWidget]
  );

  const handleSampleClick = useCallback(
    (sample: Sample) => {
      const project = projects.find(p => parseInt(p.id, 10) === sample.projectId);
      router.push(
        getMetricsCorrelationSpanUrl(
          organization,
          project?.slug,
          sample.spanId,
          sample.transactionId,
          sample.transactionSpanId
        )
      );
    },
    [projects, router, organization]
  );

  const firstWidget = widgets[0];

  const Wrapper =
    !isMultiChartMode || widgets.length === 1
      ? StyledSingleWidgetWrapper
      : StyledMetricDashboard;

  const queriesLookup = useMemo(() => {
    const lookup = new Map<string, MetricWidgetQueryParams>();
    widgets.forEach(widget => {
      lookup.set(getQuerySymbol(widget.id), widget);
    });
    return lookup;
  }, [widgets]);

  const getFormulasQueryDependencies = useCallback(
    (formula: string): MetricsQueryApiQueryParams[] => {
      const children = formula
        .split('')
        .map(char => queriesLookup.get(char))
        .filter((w): w is Exclude<typeof w, undefined> => !!w);

      const dependencies: MetricsQueryApiQueryParams[] = [];

      // ATM we recursively iterate over child formulas to find all dependencies
      // TODO(aknaus): clarify API support for this
      // TODO(aknaus): Memoize this
      children.forEach(child => {
        if (child.type === MetricQueryType.FORMULA) {
          dependencies.push(widgetToQuery(child, queriesLookup, true));
          dependencies.push(...getFormulasQueryDependencies(child.formula));
        } else {
          dependencies.push(widgetToQuery(child, queriesLookup, true));
        }
      });

      return dependencies;
    },
    [queriesLookup]
  );

  return (
    <Wrapper>
      {isMultiChartMode ? (
        widgets.map((widget, index) => (
          <MetricWidget
            queryId={widget.id}
            key={index}
            index={index}
            getChartPalette={getChartPalette}
            onSelect={setSelectedWidgetIndex}
            displayType={widget.displayType}
            focusedSeries={widget.focusedSeries}
            tableSort={widget.sort}
            queries={[
              widgetToQuery(widget, queriesLookup),
              ...(widget.type === MetricQueryType.FORMULA
                ? // TODO(aknaus): Properly parse formulas to extract identifiers
                  // This solution is limited to single character identifiers
                  getFormulasQueryDependencies(widget.formula)
                : []),
            ]}
            isSelected={selectedWidgetIndex === index}
            hasSiblings={widgets.length > 1}
            onChange={handleChange}
            filters={selection}
            focusAreaProps={focusArea}
            showQuerySymbols={showQuerySymbols}
            onSampleClick={handleSampleClick}
            chartHeight={200}
            highlightedSampleId={
              selectedWidgetIndex === index ? highlightedSampleId : undefined
            }
            context="ddm"
          />
        ))
      ) : (
        <MetricWidget
          index={0}
          getChartPalette={getChartPalette}
          onSelect={setSelectedWidgetIndex}
          displayType={firstWidget.displayType}
          focusedSeries={firstWidget.focusedSeries}
          tableSort={firstWidget.sort}
          queries={widgets.map(w => widgetToQuery(w, queriesLookup))}
          isSelected
          hasSiblings={false}
          onChange={handleChange}
          filters={selection}
          focusAreaProps={focusArea}
          showQuerySymbols={false}
          onSampleClick={handleSampleClick}
          chartHeight={200}
          highlightedSampleId={highlightedSampleId}
          context="ddm"
        />
      )}
    </Wrapper>
  );
}

const StyledMetricDashboard = styled('div')`
  display: grid;
  grid-template-columns: repeat(3, minmax(${MIN_WIDGET_WIDTH}px, 1fr));
  gap: ${space(2)};

  @media (max-width: ${props => props.theme.breakpoints.xxlarge}) {
    grid-template-columns: repeat(2, minmax(${MIN_WIDGET_WIDTH}px, 1fr));
  }
  @media (max-width: ${props => props.theme.breakpoints.xlarge}) {
    grid-template-columns: repeat(1, minmax(${MIN_WIDGET_WIDTH}px, 1fr));
  }
  grid-auto-rows: auto;
`;

const StyledSingleWidgetWrapper = styled('div')`
  display: grid;
  grid-template-columns: repeat(1, minmax(${MIN_WIDGET_WIDTH}px, 1fr));
`;
