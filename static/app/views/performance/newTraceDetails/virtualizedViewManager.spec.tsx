import type {List} from 'react-virtualized';
import {OrganizationFixture} from 'sentry-fixture/organization';

import type {RawSpanType} from 'sentry/components/events/interfaces/spans/types';
import {EntryType, type Event} from 'sentry/types';
import type {
  TraceFullDetailed,
  TraceSplitResults,
} from 'sentry/utils/performance/quickTrace/types';
import {VirtualizedViewManager} from 'sentry/views/performance/newTraceDetails/virtualizedViewManager';

import {TraceTree} from './traceTree';

function makeEvent(overrides: Partial<Event> = {}, spans: RawSpanType[] = []): Event {
  return {
    entries: [{type: EntryType.SPANS, data: spans}],
    ...overrides,
  } as Event;
}

function makeTrace(
  overrides: Partial<TraceSplitResults<TraceFullDetailed>>
): TraceSplitResults<TraceFullDetailed> {
  return {
    transactions: [],
    orphan_errors: [],
    ...overrides,
  } as TraceSplitResults<TraceFullDetailed>;
}

function makeTransaction(overrides: Partial<TraceFullDetailed> = {}): TraceFullDetailed {
  return {
    children: [],
    start_timestamp: 0,
    timestamp: 1,
    transaction: 'transaction',
    'transaction.op': '',
    'transaction.status': '',
    ...overrides,
  } as TraceFullDetailed;
}

function makeSpan(overrides: Partial<RawSpanType> = {}): RawSpanType {
  return {
    op: '',
    description: '',
    span_id: '',
    start_timestamp: 0,
    timestamp: 10,
    ...overrides,
  } as RawSpanType;
}

function makeParentAutogroupSpans(): RawSpanType[] {
  return [
    makeSpan({description: 'span', op: 'db', span_id: 'head_span'}),
    makeSpan({
      description: 'span',
      op: 'db',
      span_id: 'middle_span',
      parent_span_id: 'head_span',
    }),
    makeSpan({
      description: 'span',
      op: 'db',
      span_id: 'tail_span',
      parent_span_id: 'middle_span',
    }),
  ];
}

function makeSiblingAutogroupedSpans(): RawSpanType[] {
  return [
    makeSpan({description: 'span', op: 'db', span_id: 'first_span'}),
    makeSpan({description: 'span', op: 'db', span_id: 'middle_span'}),
    makeSpan({description: 'span', op: 'db', span_id: 'other_middle_span'}),
    makeSpan({description: 'span', op: 'db', span_id: 'another_middle_span'}),
    makeSpan({description: 'span', op: 'db', span_id: 'last_span'}),
  ];
}

function makeSingleTransactionTree(): TraceTree {
  return TraceTree.FromTrace(
    makeTrace({
      transactions: [
        makeTransaction({
          transaction: 'transaction',
          project_slug: 'project',
          event_id: 'event_id',
        }),
      ],
    })
  );
}

function makeList(): List {
  return {
    scrollToRow: jest.fn(),
  } as unknown as List;
}

describe('VirtualizedViewManger', () => {
  it('initializes space', () => {
    const manager = new VirtualizedViewManager({
      list: {width: 0.5},
      span_list: {width: 0.5},
    });

    manager.initializeTraceSpace([10_000, 0, 1000, 1]);

    expect(manager.trace_space.serialize()).toEqual([0, 0, 1000, 1]);
    expect(manager.trace_view.serialize()).toEqual([0, 0, 1000, 1]);
  });

  it('initializes physical space', () => {
    const manager = new VirtualizedViewManager({
      list: {width: 0.5},
      span_list: {width: 0.5},
    });

    manager.initializePhysicalSpace(1000, 1);

    expect(manager.container_physical_space.serialize()).toEqual([0, 0, 1000, 1]);
    expect(manager.trace_physical_space.serialize()).toEqual([0, 0, 500, 1]);
  });

  describe('computeSpanCSSMatrixTransform', () => {
    it('enforces min scaling', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 1000, 1]);
      manager.initializePhysicalSpace(1000, 1);

      expect(manager.computeSpanCSSMatrixTransform([0, 0.1])).toEqual([
        0.001, 0, 0, 1, 0, 0,
      ]);
    });
    it('computes width scaling correctly', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 100, 1]);
      manager.initializePhysicalSpace(1000, 1);

      expect(manager.computeSpanCSSMatrixTransform([0, 100])).toEqual([1, 0, 0, 1, 0, 0]);
    });

    it('computes x position correctly', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 1000, 1]);
      manager.initializePhysicalSpace(1000, 1);

      expect(manager.computeSpanCSSMatrixTransform([50, 1000])).toEqual([
        1, 0, 0, 1, 50, 0,
      ]);
    });

    it('computes span x position correctly', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 1000, 1]);
      manager.initializePhysicalSpace(1000, 1);

      expect(manager.computeSpanCSSMatrixTransform([50, 1000])).toEqual([
        1, 0, 0, 1, 50, 0,
      ]);
    });

    describe('when start is not 0', () => {
      it('computes width scaling correctly', () => {
        const manager = new VirtualizedViewManager({
          list: {width: 0},
          span_list: {width: 1},
        });

        manager.initializeTraceSpace([100, 0, 100, 1]);
        manager.initializePhysicalSpace(1000, 1);

        expect(manager.computeSpanCSSMatrixTransform([100, 100])).toEqual([
          1, 0, 0, 1, 0, 0,
        ]);
      });
      it('computes x position correctly when view is offset', () => {
        const manager = new VirtualizedViewManager({
          list: {width: 0},
          span_list: {width: 1},
        });

        manager.initializeTraceSpace([100, 0, 100, 1]);
        manager.initializePhysicalSpace(1000, 1);

        expect(manager.computeSpanCSSMatrixTransform([100, 100])).toEqual([
          1, 0, 0, 1, 0, 0,
        ]);
      });
    });
  });

  describe('computeTransformXFromTimestamp', () => {
    it('computes x position correctly', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 1000, 1]);
      manager.initializePhysicalSpace(1000, 1);

      expect(manager.computeTransformXFromTimestamp(50)).toEqual(50);
    });

    it('computes x position correctly when view is offset', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([50, 0, 1000, 1]);
      manager.initializePhysicalSpace(1000, 1);

      manager.trace_view.x = 50;

      expect(manager.computeTransformXFromTimestamp(50)).toEqual(0);
    });

    it('when view is offset and scaled', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([50, 0, 100, 1]);
      manager.initializePhysicalSpace(1000, 1);

      manager.trace_view.width = 50;
      manager.trace_view.x = 50;

      expect(Math.round(manager.computeTransformXFromTimestamp(75))).toEqual(500);
    });
  });

  describe('getConfigSpaceCursor', () => {
    it('returns the correct x position', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 100, 1]);
      manager.initializePhysicalSpace(1000, 1);

      expect(manager.getConfigSpaceCursor({x: 500, y: 0})).toEqual([50, 0]);
    });

    it('returns the correct x position when view scaled', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 100, 1]);
      manager.initializePhysicalSpace(1000, 1);

      manager.trace_view.x = 50;
      manager.trace_view.width = 50;
      expect(manager.getConfigSpaceCursor({x: 500, y: 0})).toEqual([75, 0]);
    });

    it('returns the correct x position when view is offset', () => {
      const manager = new VirtualizedViewManager({
        list: {width: 0},
        span_list: {width: 1},
      });

      manager.initializeTraceSpace([0, 0, 100, 1]);
      manager.initializePhysicalSpace(1000, 1);

      manager.trace_view.x = 50;
      expect(manager.getConfigSpaceCursor({x: 500, y: 0})).toEqual([100, 0]);
    });
  });

  describe('text positioning', () => {
    describe('non offset view', () => {
      it.todo('span is left');
      it.todo('span is right');
      it.todo('span left and over center');
    });

    describe('offset view', () => {
      it.todo('span is left');
      it.todo('span is right');
      it.todo('span left and over center');
    });

    describe('non offset zoomed in view', () => {
      it.todo('span is left');
      it.todo('span is right');
      it.todo('span left and over center');
    });

    describe('offset zoomed in view', () => {
      it.todo('span is left');
      it.todo('span is right');
      it.todo('span left and over center');
    });
  });

  describe('scrollToPath', () => {
    const organization = OrganizationFixture();
    const api = new MockApiClient();

    const manager = new VirtualizedViewManager({
      list: {width: 0.5},
      span_list: {width: 0.5},
    });

    it('scrolls to transaction', async () => {
      const tree = TraceTree.FromTrace(
        makeTrace({
          transactions: [
            makeTransaction(),
            makeTransaction({
              event_id: 'event_id',
              children: [],
            }),
          ],
        })
      );

      manager.virtualizedList = makeList();

      const result = await manager.scrollToPath(tree, ['txn:event_id'], () => void 0, {
        api: api,
        organization,
      });

      expect(result).toBe(tree.list[2]);
      expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(2);
    });

    it('scrolls to nested transaction', async () => {
      const tree = TraceTree.FromTrace(
        makeTrace({
          transactions: [
            makeTransaction({
              event_id: 'root',
              children: [
                makeTransaction({
                  event_id: 'child',
                  children: [
                    makeTransaction({
                      event_id: 'event_id',
                      children: [],
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );

      manager.virtualizedList = makeList();

      expect(tree.list[tree.list.length - 1].path).toEqual([
        'txn:event_id',
        'txn:child',
        'txn:root',
      ]);
      const result = await manager.scrollToPath(
        tree,
        ['txn:event_id', 'txn:child', 'txn:root'],
        () => void 0,
        {
          api: api,
          organization,
        }
      );

      expect(result).toBe(tree.list[tree.list.length - 1]);
      expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(3);
    });

    it('scrolls to spans of expanded transaction', async () => {
      manager.virtualizedList = makeList();

      const tree = TraceTree.FromTrace(
        makeTrace({
          transactions: [
            makeTransaction({
              event_id: 'event_id',
              project_slug: 'project_slug',
              children: [],
            }),
          ],
        })
      );

      MockApiClient.addMockResponse({
        url: '/organizations/org-slug/events/project_slug:event_id/',
        method: 'GET',
        body: makeEvent(undefined, [makeSpan({span_id: 'span_id'})]),
      });

      const result = await manager.scrollToPath(
        tree,
        ['span:span_id', 'txn:event_id'],
        () => void 0,
        {
          api: api,
          organization,
        }
      );

      expect(tree.list[1].zoomedIn).toBe(true);
      expect(result).toBeTruthy();
      expect(result).toBe(tree.list[2]);
      expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(2);
    });

    it('scrolls to span -> transaction -> span -> transaction', async () => {
      manager.virtualizedList = makeList();

      const tree = TraceTree.FromTrace(
        makeTrace({
          transactions: [
            makeTransaction({
              event_id: 'event_id',
              project_slug: 'project_slug',
              children: [
                makeTransaction({
                  parent_span_id: 'child_span',
                  event_id: 'child_event_id',
                  project_slug: 'project_slug',
                }),
              ],
            }),
          ],
        })
      );

      MockApiClient.addMockResponse({
        url: '/organizations/org-slug/events/project_slug:event_id/',
        method: 'GET',
        body: makeEvent(undefined, [
          makeSpan({span_id: 'other_child_span'}),
          makeSpan({span_id: 'child_span'}),
        ]),
      });

      MockApiClient.addMockResponse({
        url: '/organizations/org-slug/events/project_slug:child_event_id/',
        method: 'GET',
        body: makeEvent(undefined, [makeSpan({span_id: 'other_child_span'})]),
      });

      const result = await manager.scrollToPath(
        tree,
        ['span:other_child_span', 'txn:child_event_id', 'txn:event_id'],
        () => void 0,
        {
          api: api,
          organization,
        }
      );

      expect(result).toBeTruthy();
      expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(3);
    });

    describe('scrolls to directly autogrouped node', () => {
      for (const headOrTailId of ['head_span', 'tail_span']) {
        it('scrolls to directly autogrouped node head', async () => {
          manager.virtualizedList = makeList();
          const tree = makeSingleTransactionTree();

          MockApiClient.addMockResponse({
            url: '/organizations/org-slug/events/project:event_id/',
            method: 'GET',
            body: makeEvent({}, makeParentAutogroupSpans()),
          });

          const result = await manager.scrollToPath(
            tree,
            [`ag:${headOrTailId}`, 'txn:event_id'],
            () => void 0,
            {
              api: api,
              organization,
            }
          );

          expect(result).toBeTruthy();
          expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(2);
        });
      }

      for (const headOrTailId of ['head_span', 'tail_span']) {
        it('scrolls to child of autogrouped node head or tail', async () => {
          manager.virtualizedList = makeList();
          const tree = makeSingleTransactionTree();

          MockApiClient.addMockResponse({
            url: '/organizations/org-slug/events/project:event_id/',
            method: 'GET',
            body: makeEvent({}, makeParentAutogroupSpans()),
          });

          const result = await manager.scrollToPath(
            tree,
            ['span:middle_span', `ag:${headOrTailId}`, 'txn:event_id'],
            () => void 0,
            {
              api: api,
              organization,
            }
          );

          expect(result).toBeTruthy();
          expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(4);
        });
      }
    });

    describe('sibling autogrouping', () => {
      it('scrolls to sibling autogrouped node', async () => {
        manager.virtualizedList = makeList();
        const tree = makeSingleTransactionTree();

        MockApiClient.addMockResponse({
          url: '/organizations/org-slug/events/project:event_id/',
          method: 'GET',
          body: makeEvent({}, makeSiblingAutogroupedSpans()),
        });

        const result = await manager.scrollToPath(
          tree,
          [`ag:first_span`, 'txn:event_id'],
          () => void 0,
          {
            api: api,
            organization,
          }
        );

        expect(result).toBeTruthy();
        expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(2);
      });

      it('scrolls to child span of sibling autogrouped node', async () => {
        manager.virtualizedList = makeList();
        const tree = makeSingleTransactionTree();

        MockApiClient.addMockResponse({
          url: '/organizations/org-slug/events/project:event_id/',
          method: 'GET',
          body: makeEvent({}, makeSiblingAutogroupedSpans()),
        });

        const result = await manager.scrollToPath(
          tree,
          ['span:middle_span', `ag:first_span`, 'txn:event_id'],
          () => void 0,
          {
            api: api,
            organization,
          }
        );

        expect(result).toBeTruthy();
        expect(manager.virtualizedList.scrollToRow).toHaveBeenCalledWith(4);
      });

      it.todo('scrolls to orphan transactions');
      it.todo('scrolls to orphan transactions child span');
    });
  });
});
