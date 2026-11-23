import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';

import { FrameworkService, HIERARCHY_PAGE_LIMIT } from './framework.service';
import { NSOrgHierarchy } from '../models/org-hierarchy.model';

const HIERARCHY_URL = '/apis/proxies/v8/org/v2/hierarchy/read/';
const LEVELS: NSOrgHierarchy.ILevel[] = [
  { level: 1, name: 'Ministry' },
  { level: 2, name: 'Department' },
  { level: 3, name: 'Directorate / Board' },
  { level: 4, name: 'Field Unit' },
];

function ok(result: Partial<NSOrgHierarchy.IReadResult>): NSOrgHierarchy.IReadResponse {
  return {
    id: 'api.org.hierarchy.read', ver: 'v2', ts: '',
    params: { resmsgid: 'x', msgid: 'x', err: null, status: 'SUCCESS', errmsg: null },
    responseCode: 'OK',
    result: result as NSOrgHierarchy.IReadResult,
  };
}

function assoc(id: string, level = 2, childCount = 2): NSOrgHierarchy.IAssociation {
  return { id, name: `Org ${id}`, idle: false, childCount, level };
}

function ids(n: number, prefix: string, start = 0): string[] {
  return Array.from({ length: n }, (_v, i) => `${prefix}${start + i}`);
}

describe('FrameworkService org hierarchy (v2)', () => {
  let service: FrameworkService;
  let httpMock: HttpTestingController;

  const hierarchyRequests = (orgId?: string): TestRequest[] =>
    httpMock.match(r => r.url.startsWith(HIERARCHY_URL) && (!orgId || r.url === HIERARCHY_URL + orgId));
  const flushUserCounts = (counts: { [id: string]: number } = {}) =>
    httpMock.match(r => r.url.includes('user/v1/search')).filter(r => !r.cancelled).forEach(r => r.flush({
      result: { response: { count: 1, facets: [{ name: 'rootOrgId', values: Object.keys(counts).map(name => ({ name, count: counts[name] })) }] } },
    }));

  /** Loads the root org (normal mode): first column = root's children */
  function loadRoot(firstPage: string[] = ['a', 'b'], hasMore = false, childCount = firstPage.length) {
    service.loadOrgHierarchy({ identifier: 'root', id: 'root', orgHierarchyFrameworkId: 'fw_root' }).subscribe();
    const req = httpMock.expectOne(HIERARCHY_URL + 'root');
    req.flush(ok({
      id: 'root', name: 'Root', level: 1, childCount, associations: firstPage.map(id => assoc(id)),
      levels: LEVELS, currentMaxLevel: 3, maxAllowedLevel: 4, limit: HIERARCHY_PAGE_LIMIT, hasMore,
    }));
    return req;
  }

  /** Simulates selecting a card of the first column (what TreeView.updateFinalList does) */
  function select(columnCode: string, id: string) {
    const term = service.list.get(columnCode)!.children.find((t: any) => t.identifier === id);
    service.selectionList.set(columnCode, { ...term });
    service.selectHierarchyParent(columnCode, term);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(FrameworkService);
    httpMock = TestBed.inject(HttpTestingController);
    service.setConfig({ config: [{ showSearch: true }] });
  });

  afterEach(() => {
    flushUserCounts();
    httpMock.verify();
    service.resetHierarchyState();
  });

  describe('readOrgHierarchy', () => {
    it('should POST query/limit/offset/countDescendants to /org/v2/hierarchy/read/{orgId} with an empty query when none is given', () => {
      service.readOrgHierarchy('org1', { offset: 0, limit: 20 }).subscribe();
      const req = httpMock.expectOne(HIERARCHY_URL + 'org1');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ request: { query: '', limit: 20, offset: 0, countDescendants: false, levelRequired: true } });
      req.flush(ok({ id: 'org1', associations: [] }));
    });

    it('should include the trimmed search query when present', () => {
      service.readOrgHierarchy('org1', { offset: 40, limit: 20, query: ' Department ' }).subscribe();
      const req = httpMock.expectOne(HIERARCHY_URL + 'org1');
      expect(req.request.body).toEqual({ request: { query: 'Department', limit: 20, offset: 40, countDescendants: false, levelRequired: true } });
      req.flush(ok({ id: 'org1', associations: [] }));
    });

    it('should error when params.status is not SUCCESS', () => {
      let error: any;
      service.readOrgHierarchy('org1', { offset: 0, limit: 0 }).subscribe({ error: e => error = e });
      httpMock.expectOne(HIERARCHY_URL + 'org1').flush({
        id: 'api.org.v2.hierarchy.read.org1', ver: 'v2', ts: '', responseCode: 'BAD_REQUEST',
        params: { resmsgid: 'x', msgid: 'x', err: 'INVALID_REQUEST', status: 'FAILED', errmsg: 'request.limit: limit must be greater than 0' },
      });
      expect(error.message).toBe('request.limit: limit must be greater than 0');
    });
  });

  describe('initial load', () => {
    it('should build one column per level below the root and format the first page', () => {
      loadRoot(['a', 'b'], true, 25);
      const columns = Array.from(service.list.values());
      expect(columns.map(c => c.name)).toEqual(['Department', 'Directorate / Board', 'Field Unit']);
      expect(columns.map(c => c.index)).toEqual([1, 2, 3]);
      expect(columns.map(c => c.hasData)).toEqual([true, true, false]);
      expect(service.categoriesHash.value.map(c => c.code)).toEqual(['level2', 'level3', 'level4']);
      expect(service.isOrgHierarchyMode).toBeTrue();
      expect(service.getFrameworkId()).toBe('fw_root');

      const first = columns[0].children;
      expect(first.map((t: any) => t.identifier)).toEqual(['a', 'b']);
      // (jasmine.objectContaining throws "i is not defined" with this jasmine setup, so compare picked fields)
      const card: any = first[0];
      expect({ identifier: card.identifier, code: card.code, name: card.name, category: card.category,
        childCount: card.childCount, userCount: card.userCount, additionalProperties: card.additionalProperties }).toEqual({
        identifier: 'a', code: 'a', name: 'Org a', category: 'level2', childCount: 2, userCount: 0,
        additionalProperties: { orgId: 'a' },
      });
      const state = service.getHierarchyColumnState('level2')!;
      expect([state.parentId, state.offset, state.nextOffset, state.total, state.hasMore, state.query])
        .toEqual(['root', 0, 20, 25, true, '']);
    });

    it('should fetch user counts for the loaded page and map them to the cards', () => {
      loadRoot(['a', 'b']);
      const userReq = httpMock.expectOne(r => r.url.includes('user/v1/search'));
      expect(userReq.request.body.request.filters.rootOrgId).toEqual(['a', 'b']);
      expect(userReq.request.body.request.facets).toEqual(['rootOrgId']);
      userReq.flush({ result: { response: { count: 7, facets: [{ name: 'rootOrgId', values: [{ name: 'a', count: 7 }] }] } } });
      const cards = service.list.get('level2')!.children;
      expect(cards[0].userCount).toBe(7);
      expect(cards[1].userCount).toBe(0);
      expect(service.getUserCount(cards[0])).toBe(7);
    });

    it('should keep user counts at 0 when the user count API fails', () => {
      loadRoot(['a']);
      httpMock.expectOne(r => r.url.includes('user/v1/search')).flush('fail', { status: 500, statusText: 'Server Error' });
      expect(service.list.get('level2')!.children[0].userCount).toBe(0);
    });

    it('should keep showing the current tree while it reloads', () => {
      loadRoot(['a', 'b']);
      service.loadOrgHierarchy({ identifier: 'root', id: 'root', orgHierarchyFrameworkId: 'fw_root' }).subscribe();
      expect(service.list.get('level2')!.children.length).toBe(2);
      httpMock.expectOne(HIERARCHY_URL + 'root').flush(ok({
        id: 'root', level: 1, childCount: 3, associations: [assoc('a'), assoc('b'), assoc('c')], levels: LEVELS, limit: 20, hasMore: false,
      }));
      expect(service.list.get('level2')!.children.length).toBe(3);
    });

    it('should clear the tree and error when the root request fails', () => {
      let error: any;
      service.loadOrgHierarchy({ identifier: 'root', orgHierarchyFrameworkId: 'fw' }).subscribe({ error: e => error = e });
      httpMock.expectOne(HIERARCHY_URL + 'root').flush('fail', { status: 500, statusText: 'Server Error' });
      expect(error).toBeTruthy();
      expect(service.list.size).toBe(0);
      expect(service.categoriesHash.value.length).toBe(0);
    });

    it('should start from the child org for a child org admin and seed its children', () => {
      service.loadOrgHierarchy(
        { id: 'root', identifier: 'root', orgHierarchyFrameworkId: 'fw' },
        { id: 'child', rootOrgId: 'child', channel: 'Child Org' }
      ).subscribe();
      httpMock.expectOne(HIERARCHY_URL + 'child').flush(ok({
        id: 'child', name: 'Child Org', level: 2, childCount: 1, associations: [assoc('c1', 3)],
        levels: LEVELS, currentMaxLevel: 3, maxAllowedLevel: 4, limit: 20, hasMore: false,
      }));
      const columns = Array.from(service.list.values());
      expect(columns.map(c => c.name)).toEqual(['Department', 'Directorate / Board', 'Field Unit']);
      expect(columns[0].children.map((t: any) => t.identifier)).toEqual(['child']);
      expect(service.getHierarchyColumnState('level2')!.localOnly).toBeTrue();
      expect(service.isServerPagedColumn('level2')).toBeFalse();
      expect(columns[1].children.map((t: any) => t.identifier)).toEqual(['c1']);

      // selecting the child org re-uses the seeded page: no extra request
      select('level2', 'child');
      expect(hierarchyRequests().length).toBe(0);
    });
  });

  describe('card selection', () => {
    it('should load the first page of the selected card into the next column', () => {
      loadRoot(['a', 'b']);
      select('level2', 'a');
      const req = httpMock.expectOne(HIERARCHY_URL + 'a');
      expect(req.request.body).toEqual({ request: { query: '', limit: HIERARCHY_PAGE_LIMIT, offset: 0, countDescendants: false, levelRequired: true } });
      expect(service.getHierarchyColumnState('level3')!.isLoading).toBeTrue();
      req.flush(ok({ id: 'a', childCount: 2, associations: [assoc('a1', 3), assoc('a2', 3)], limit: 20, hasMore: false }));
      expect(service.list.get('level3')!.children.map((t: any) => t.identifier)).toEqual(['a1', 'a2']);
      expect(service.getHierarchyColumnState('level3')!.parentId).toBe('a');
    });

    it('should not call the API again when the same parent is re-selected', () => {
      loadRoot(['a']);
      select('level2', 'a');
      httpMock.expectOne(HIERARCHY_URL + 'a').flush(ok({ id: 'a', associations: [assoc('a1', 3)], hasMore: false }));
      select('level2', 'a');
      expect(hierarchyRequests().length).toBe(0);
    });

    it('should not call the API for a card without children', () => {
      service.loadOrgHierarchy({ identifier: 'root', orgHierarchyFrameworkId: 'fw' }).subscribe();
      httpMock.expectOne(HIERARCHY_URL + 'root').flush(ok({
        id: 'root', level: 1, childCount: 1, associations: [assoc('leaf', 2, 0)], levels: LEVELS, limit: 20, hasMore: false,
      }));
      select('level2', 'leaf');
      expect(hierarchyRequests().length).toBe(0);
      const state = service.getHierarchyColumnState('level3')!;
      expect(state.records).toEqual([]);
      expect(state.total).toBe(0);
    });

    it('should replace the next column and reset downstream columns when another card is selected', () => {
      loadRoot(['a', 'b']);
      select('level2', 'a');
      httpMock.expectOne(HIERARCHY_URL + 'a').flush(ok({ id: 'a', associations: [assoc('a1', 3)], hasMore: false }));
      select('level3', 'a1');
      httpMock.expectOne(HIERARCHY_URL + 'a1').flush(ok({ id: 'a1', associations: [assoc('a1x', 4)], hasMore: false }));
      expect(service.list.get('level4')!.children.length).toBe(1);

      select('level2', 'b');
      expect(service.getHierarchyColumnState('level4')).toBeNull();
      expect(service.list.get('level4')!.children).toEqual([]);
      expect(service.list.get('level3')!.children).toEqual([]); // old parent's children are not kept
      httpMock.expectOne(HIERARCHY_URL + 'b').flush(ok({ id: 'b', associations: [assoc('b1', 3)], hasMore: false }));
      expect(service.list.get('level3')!.children.map((t: any) => t.identifier)).toEqual(['b1']);
    });

    it('should ignore the response of a previously selected card that arrives late', () => {
      loadRoot(['a', 'b']);
      select('level2', 'a');
      const slow = httpMock.expectOne(HIERARCHY_URL + 'a');
      select('level2', 'b');
      expect(slow.cancelled).toBeTrue();
      httpMock.expectOne(HIERARCHY_URL + 'b').flush(ok({ id: 'b', associations: [assoc('b1', 3)], hasMore: false }));
      expect(service.list.get('level3')!.children.map((t: any) => t.identifier)).toEqual(['b1']);
    });

    it('should keep the previous hierarchy intact and allow a retry when a child request fails', () => {
      loadRoot(['a']);
      select('level2', 'a');
      httpMock.expectOne(HIERARCHY_URL + 'a').flush('fail', { status: 500, statusText: 'Server Error' });
      expect(service.list.get('level2')!.children.map((t: any) => t.identifier)).toEqual(['a']);
      expect(service.getHierarchyColumnState('level3')!.error).toBeTruthy();
      select('level2', 'a'); // same parent after an error -> retried
      httpMock.expectOne(HIERARCHY_URL + 'a').flush(ok({ id: 'a', associations: [assoc('a1', 3)], hasMore: false }));
      expect(service.list.get('level3')!.children.length).toBe(1);
    });
  });

  describe('pagination', () => {
    it('should request offset 20, 40 ... and append the pages', () => {
      loadRoot(ids(20, 'r'), true, 45);
      expect(service.loadNextHierarchyPage('level2')).toBeTrue();
      let req = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(req.request.body).toEqual({ request: { query: '', limit: 20, offset: 20, countDescendants: false, levelRequired: true } });
      req.flush(ok({ id: 'root', childCount: 45, associations: ids(20, 'r', 20).map(id => assoc(id)), limit: 20, hasMore: true }));
      expect(service.list.get('level2')!.children.length).toBe(40);

      service.loadNextHierarchyPage('level2');
      req = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(req.request.body.request.offset).toBe(40);
      req.flush(ok({ id: 'root', associations: ids(5, 'r', 40).map(id => assoc(id)), limit: 20, hasMore: false }));
      expect(service.list.get('level2')!.children.length).toBe(45);
      expect(service.getHierarchyColumnState('level2')!.total).toBe(45);

      expect(service.loadNextHierarchyPage('level2')).toBeFalse(); // hasMore false -> stop
      expect(hierarchyRequests().length).toBe(0);
    });

    it('should not send a second page request while one is pending', () => {
      loadRoot(ids(20, 'r'), true, 30);
      expect(service.loadNextHierarchyPage('level2')).toBeTrue();
      expect(service.loadNextHierarchyPage('level2')).toBeFalse();
      const reqs = hierarchyRequests('root');
      expect(reqs.length).toBe(1);
      reqs[0].flush(ok({ id: 'root', associations: [], limit: 20, hasMore: false }));
    });

    it('should not add duplicate records returned by a later page', () => {
      loadRoot(['a', 'b'], true);
      service.loadNextHierarchyPage('level2');
      httpMock.expectOne(HIERARCHY_URL + 'root').flush(ok({ id: 'root', associations: [assoc('b'), assoc('c')], limit: 20, hasMore: false }));
      expect(service.list.get('level2')!.children.map((t: any) => t.identifier)).toEqual(['a', 'b', 'c']);
    });

    it('should not advance the offset when a page request fails, so the page can be retried', () => {
      loadRoot(ids(20, 'r'), true, 30);
      service.loadNextHierarchyPage('level2');
      httpMock.expectOne(HIERARCHY_URL + 'root').flush('fail', { status: 500, statusText: 'Server Error' });
      const state = service.getHierarchyColumnState('level2')!;
      expect(state.nextOffset).toBe(20);
      expect(state.hasMore).toBeTrue();
      expect(state.records.length).toBe(20);
      service.loadNextHierarchyPage('level2');
      const retry = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(retry.request.body.request.offset).toBe(20);
      retry.flush(ok({ id: 'root', associations: [], limit: 20, hasMore: false }));
    });

    it('should keep pagination independent per column', () => {
      loadRoot(ids(20, 'r'), true, 30);
      select('level2', 'r0');
      httpMock.expectOne(HIERARCHY_URL + 'r0').flush(ok({ id: 'r0', associations: ids(20, 'k').map(id => assoc(id, 3)), limit: 20, hasMore: true }));

      service.loadNextHierarchyPage('level3');
      const childPage = httpMock.expectOne(HIERARCHY_URL + 'r0');
      expect(childPage.request.body.request.offset).toBe(20);
      childPage.flush(ok({ id: 'r0', associations: [assoc('k20', 3)], limit: 20, hasMore: false }));

      expect(service.getHierarchyColumnState('level2')!.nextOffset).toBe(20);
      expect(service.list.get('level2')!.children.length).toBe(20);
      expect(service.list.get('level3')!.children.length).toBe(21);
    });

    it('should use the page size returned by the API to compute the next offset', () => {
      loadRoot(['a'], true);
      service.loadNextHierarchyPage('level2');
      const req = httpMock.expectOne(HIERARCHY_URL + 'root');
      req.flush(ok({ id: 'root', associations: [assoc('b')], limit: 50, hasMore: true }));
      expect(service.getHierarchyColumnState('level2')!.nextOffset).toBe(20 + 50);
    });
  });

  describe('search', () => {
    it('should search from offset 0 for the column parent and replace the records', () => {
      loadRoot(ids(20, 'r'), true, 30);
      service.loadNextHierarchyPage('level2');
      httpMock.expectOne(HIERARCHY_URL + 'root').flush(ok({ id: 'root', associations: [assoc('r20')], limit: 20, hasMore: true }));

      expect(service.searchHierarchyColumn('level2', 'Dep')).toBeTrue();
      const req = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(req.request.body).toEqual({ request: { query: 'Dep', limit: 20, offset: 0, countDescendants: false, levelRequired: true } });
      req.flush(ok({ id: 'root', childCount: 2, associations: [assoc('d1'), assoc('d2')], limit: 20, hasMore: true }));

      const state = service.getHierarchyColumnState('level2')!;
      expect(state.records.map(r => r.identifier)).toEqual(['d1', 'd2']);
      expect(state.query).toBe('Dep');
      expect(state.total).toBe(30); // header total stays the unfiltered child count

      service.loadNextHierarchyPage('level2'); // filtered results paginate too
      const next = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(next.request.body).toEqual({ request: { query: 'Dep', limit: 20, offset: 20, countDescendants: false, levelRequired: true } });
      next.flush(ok({ id: 'root', associations: [assoc('d3')], limit: 20, hasMore: false }));
      expect(state.records.length).toBe(2);
      expect(service.getHierarchyColumnState('level2')!.records.length).toBe(3);
    });

    it('should discard the results of an older query when a newer one is typed', () => {
      loadRoot(['a', 'b']);
      service.searchHierarchyColumn('level2', 'Old');
      const oldReq = httpMock.expectOne(HIERARCHY_URL + 'root');
      service.searchHierarchyColumn('level2', 'New');
      expect(oldReq.cancelled).toBeTrue();
      const newReq = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(newReq.request.body.request.query).toBe('New');
      newReq.flush(ok({ id: 'root', associations: [assoc('n1')], limit: 20, hasMore: false }));
      expect(service.getHierarchyColumnState('level2')!.records.map(r => r.identifier)).toEqual(['n1']);
    });

    it('should cancel a pending page request when a search starts', () => {
      loadRoot(ids(20, 'r'), true, 30);
      service.loadNextHierarchyPage('level2');
      const pageReq = httpMock.expectOne(HIERARCHY_URL + 'root');
      service.searchHierarchyColumn('level2', 'x');
      expect(pageReq.cancelled).toBeTrue();
      httpMock.expectOne(HIERARCHY_URL + 'root').flush(ok({ id: 'root', associations: [], limit: 20, hasMore: false }));
      expect(service.getHierarchyColumnState('level2')!.records).toEqual([]);
    });

    it('should reload the normal first page when the search is cleared', () => {
      loadRoot(['a', 'b']);
      service.searchHierarchyColumn('level2', 'a');
      httpMock.expectOne(HIERARCHY_URL + 'root').flush(ok({ id: 'root', associations: [assoc('a')], limit: 20, hasMore: false }));
      service.searchHierarchyColumn('level2', '');
      const req = httpMock.expectOne(HIERARCHY_URL + 'root');
      expect(req.request.body).toEqual({ request: { query: '', limit: 20, offset: 0, countDescendants: false, levelRequired: true } });
      req.flush(ok({ id: 'root', childCount: 2, associations: [assoc('a'), assoc('b')], limit: 20, hasMore: false }));
      expect(service.getHierarchyColumnState('level2')!.records.length).toBe(2);
      expect(service.getHierarchyColumnState('level2')!.query).toBe('');
    });

    it('should keep the column search when another parent is selected', () => {
      loadRoot(['a', 'b']);
      select('level2', 'a');
      httpMock.expectOne(HIERARCHY_URL + 'a').flush(ok({ id: 'a', associations: [assoc('a1', 3)], hasMore: false }));
      service.searchHierarchyColumn('level3', 'q');
      httpMock.expectOne(HIERARCHY_URL + 'a').flush(ok({ id: 'a', associations: [], hasMore: false }));
      select('level2', 'b');
      const req = httpMock.expectOne(HIERARCHY_URL + 'b');
      expect(req.request.body).toEqual({ request: { query: 'q', limit: 20, offset: 0, countDescendants: false, levelRequired: true } });
      req.flush(ok({ id: 'b', associations: [], hasMore: false }));
    });
  });

  describe('edit context (framework terms for add/update/remove)', () => {
    const framework = {
      code: 'fw_root',
      categories: [
        { code: 'cat2', index: 2, terms: [{ code: 'T_B1', identifier: 'fw_root_cat2_T_B1', category: 'cat2', additionalProperties: { orgId: 'a1' } }] },
        { code: 'cat1', index: 1, terms: [{ code: 'T_A', identifier: 'fw_root_cat1_T_A', category: 'cat1', additionalProperties: { orgId: 'a' },
          associations: [{ code: 'T_B1', identifier: 'fw_root_cat2_T_B1', category: 'cat2' }] }] },
      ],
    };

    it('should load the framework once, on demand', () => {
      loadRoot(['a']);
      let done = 0;
      service.ensureOrgEditContext({ identifier: 'root', orgHierarchyFrameworkId: 'fw_root' }).subscribe(() => done++);
      httpMock.expectOne('/apis/proxies/v8/framework/v1/read/fw_root').flush({ result: { framework: JSON.parse(JSON.stringify(framework)) } });
      httpMock.expectNone('/apis/proxies/v8/org/v1/search'); // organisations are fetched by the add modal
      expect(done).toBe(1);
      expect(service.completeResponse.categories.map((c: any) => c.code)).toEqual(['cat1', 'cat2']);
      expect(service.completeResponse.categories[0].terms[0].children.length).toBe(1);

      service.ensureOrgEditContext({ identifier: 'root', orgHierarchyFrameworkId: 'fw_root' }).subscribe(() => done++);
      expect(done).toBe(2); // cached, no new request
    });

    it('should map columns and hierarchy records to framework categories and terms', () => {
      loadRoot(['a']);
      service.completeResponse = JSON.parse(JSON.stringify({ ...framework, categories: [framework.categories[1], framework.categories[0]] }));
      expect(service.getFrameworkCategoryCode('level2')).toBe('cat1');
      expect(service.getFrameworkCategoryCode('level3')).toBe('cat2'); // positional when not loaded yet
      const card = service.list.get('level2')!.children[0];
      const term = service.toFrameworkTerm({ ...card, cardRef: 'ref' });
      expect(term.code).toBe('T_A');
      expect(term.category).toBe('cat1');
      expect(term.cardRef).toBe('ref');
    });
  });

  it('getFrameworkInfo should leave org hierarchy mode', () => {
    loadRoot(['a']);
    service.updateEnvironment({ frameworkName: 'fw' });
    service.getFrameworkInfo().subscribe();
    expect(service.isOrgHierarchyMode).toBeFalse();
    httpMock.expectOne('/apis/proxies/v8/framework/v1/read/fw').flush({ result: { framework: { code: 'fw', categories: [] } } });
  });

  describe('unmapped organisations', () => {
    const UNMAPPED_URL = '/apis/proxies/v8/org/v2/hierarchy/unmapped-orgs';
    const result = { count: 1, page: 0, limit: 50, organizations: [{ id: 'o1', name: 'Org One' }] };

    it('should search a state with the given page and query', () => {
      let received: any;
      service.getUnmappedOrgs({ identifier: 'state1', sbOrgType: 'state' }, { page: 2, limit: 50, query: ' District ' })
        .subscribe(res => received = res);
      const req = httpMock.expectOne(UNMAPPED_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        request: {
          filters: { status: 1, ministryOrStateType: 'state', ministryOrStateId: 'state1' },
          query: 'District',
          page: 2,
          limit: 50,
        },
      });
      req.flush({ params: { status: 'SUCCESS' }, result });
      expect(received).toEqual(result);
    });

    it('should search a centre org as ministry', () => {
      service.getUnmappedOrgs({ rootOrgId: 'min1', sbOrgType: 'Ministry' }, { page: 0, limit: 50 }).subscribe();
      const req = httpMock.expectOne(UNMAPPED_URL);
      expect(req.request.body.request.filters).toEqual({ status: 1, ministryOrStateType: 'ministry', ministryOrStateId: 'min1' });
      expect(req.request.body.request.query).toBe('');
      req.flush({ params: { status: 'SUCCESS' }, result });
    });

    it('should error when the API does not succeed', () => {
      let error: any;
      service.getUnmappedOrgs({ identifier: 'state1', sbOrgType: 'state' }, { page: 0, limit: 50 }).subscribe({ error: e => error = e });
      httpMock.expectOne(UNMAPPED_URL).flush({ params: { status: 'FAILED', errmsg: 'bad request' } });
      expect(error.message).toBe('bad request');
    });
  });
});
