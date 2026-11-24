import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { TreeHierarchyService } from './tree-hierarchy.service';

describe('TreeHierarchyService', () => {
  let service: TreeHierarchyService;
  let httpMock: HttpTestingController;
  const frameworkObj = { id: 'fw1', category: 'cat1' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(TreeHierarchyService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('orgSerachApi should POST to org search', () => {
    service.orgSerachApi({}).subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/org/v1/search');
    expect(call.request.method).toBe('POST');
    call.flush({});
  });

  it('linkOrgHierarchy should POST the parent and child org ids to /org/v2/hierarchy/link', () => {
    service.linkOrgHierarchy('p1', ['c1', 'c2']).subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/org/v2/hierarchy/link');
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual({
      request: { parentOrgId: 'p1', associations: [{ childOrgId: 'c1' }, { childOrgId: 'c2' }] }
    });
    call.flush({});
  });

  it('unlinkOrgHierarchy should POST the org id with requireLeaf false to /org/v2/hierarchy/unlink', () => {
    service.unlinkOrgHierarchy('o1').subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/org/v2/hierarchy/unlink');
    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual({ request: { orgId: 'o1', requireLeaf: false } });
    call.flush({});
  });

  it('isActionSuccess should only accept params.status SUCCESS', () => {
    expect(service.isActionSuccess({ params: { status: 'SUCCESS' } } as any)).toBeTrue();
    expect(service.isActionSuccess({ params: { status: 'FAILED', errmsg: 'x' } } as any)).toBeFalse();
    expect(service.isActionSuccess(null)).toBeFalse();
  });

  it('createTerm should POST with framework and category params', () => {
    service.createTerm({}, frameworkObj).subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/action/framework/v3/term/create?framework=fw1&category=cat1');
    expect(call.request.method).toBe('POST');
    call.flush({});
  });

  it('updateFrameworkAssociation should PATCH the term update url', () => {
    service.updateFrameworkAssociation({}, frameworkObj, 'code1').subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/framework/v1/term/update/code1?framework=fw1&category=cat1');
    expect(call.request.method).toBe('PATCH');
    call.flush({});
  });

  it('publishFreamework should POST to publish with the framework id', () => {
    service.publishFreamework(frameworkObj).subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/framework/v1/publish/fw1');
    expect(call.request.method).toBe('POST');
    call.flush({});
  });

  it('updateHierarchyLevels should PATCH the levels of the root org', () => {
    const levels = [{ level: 1, name: 'Ministry', description: 'Central Government Ministry' }];
    service.updateHierarchyLevels('org1', levels).subscribe();
    const call = httpMock.expectOne('/apis/proxies/v8/org/v2/hierarchy/levels/org1');
    expect(call.request.method).toBe('PATCH');
    expect(call.request.body).toEqual({ request: { levels } });
    call.flush({});
  });

  it('setLoaderState should emit on loaderState$', () => {
    let state: boolean | undefined;
    service.loaderState$.subscribe(s => state = s);
    service.setLoaderState(true);
    expect(state).toBeTrue();
  });
});
