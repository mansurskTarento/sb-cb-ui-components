import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { NSOrgHierarchy } from './models/org-hierarchy.model';

/** Page size requested from the org-lookup API */
export const ORG_LOOKUP_PAGE_LIMIT = 50

const API_ENDPOINT = {
  ORG_V1_SEARCH: '/apis/proxies/v8/org/v1/search',
  CREATE_TERMS: `/apis/proxies/v8/action/framework/v3/term/create`,
  UPDATE_TERMS: `/apis/proxies/v8/framework/v1/term/update/`,
  UPDATE_ASSOCIATION: `/apis/proxies/v8/framework/v1/term/update/`,
  PUBLISH_FRAMEWORK: `/apis/proxies/v8/framework/v1/publish/`,
  RETIRE_TREM: `/apis/proxies/v8/framework/v1/term/retire`,
  UPDATE_CATEGORY: `/apis/proxies/v8/framework/v1/category/update/`,
  USERS_SEARCH: `apis/proxies/v8/user/v1/search`,
  ORG_CONTENT_UPDATE: `/apis/proxies/v8/org/ext/v2/update`,
  ORG_HIERARCHY_LINK: `/apis/proxies/v8/org/v2/hierarchy/link`,
  ORG_HIERARCHY_UNLINK: `/apis/proxies/v8/org/v2/hierarchy/unlink`,
  ORG_HIERARCHY_ORG_LOOKUP: `/apis/proxies/v8/org/v2/hierarchy/org-lookup`,
  ORG_HIERARCHY_MOVE: `/apis/proxies/v8/org/v2/hierarchy/move`,
}
@Injectable({
  providedIn: 'root'
})
export class TreeHierarchyService {

  private loaderSubject = new BehaviorSubject<boolean>(false);
  loaderState$ = this.loaderSubject.asObservable();

  constructor(private http: HttpClient,) { }

  orgSerachApi(requestBody: any): Observable<any> {
    return this.http.post(`${API_ENDPOINT.ORG_V1_SEARCH}`, requestBody);
  }

  /** Links child orgs under a parent org in the org hierarchy */
  linkOrgHierarchy(parentOrgId: string, childOrgIds: string[]): Observable<NSOrgHierarchy.IActionResponse> {
    const requestBody: NSOrgHierarchy.ILinkRequest = {
      request: {
        parentOrgId,
        associations: childOrgIds.map(childOrgId => ({ childOrgId })),
      }
    }
    return this.http.post<NSOrgHierarchy.IActionResponse>(`${API_ENDPOINT.ORG_HIERARCHY_LINK}`, requestBody)
  }

  /** Removes an org (with requireLeaf=false, also when it has children) from the org hierarchy */
  unlinkOrgHierarchy(orgId: string, requireLeaf = false): Observable<NSOrgHierarchy.IActionResponse> {
    const requestBody: NSOrgHierarchy.IUnlinkRequest = {
      request: { orgId, requireLeaf }
    }
    return this.http.post<NSOrgHierarchy.IActionResponse>(`${API_ENDPOINT.ORG_HIERARCHY_UNLINK}`, requestBody)
  }

  /** true when a v2 org hierarchy API (link / unlink / org-lookup) succeeded */
  isActionSuccess(res: { params?: NSOrgHierarchy.IResponseParams } | null | undefined): boolean {
    return !!res && (res.params?.status || '').toUpperCase() === 'SUCCESS'
  }

  /** @deprecated org hierarchy uses linkOrgHierarchy; no longer called by the library */
  createTerm(requestBody: any, frameworkObj:any): Observable<any> {
    return this.http.post(`${API_ENDPOINT.CREATE_TERMS}?framework=${frameworkObj.id}&category=${frameworkObj.category}`, requestBody);
  }

  updateTerm(requestBody: any, frameworkObj:any, codeId:any): Observable<any> {
    return this.http.patch(`${API_ENDPOINT.UPDATE_TERMS}/${codeId}?framework=${frameworkObj.id}&category=${frameworkObj.category}`, requestBody);
  }

  updateFrameworkAssociation(requestBody: any, frameworkObj:any, codeId:any): Observable<any> {
    return this.http.patch(`${API_ENDPOINT.UPDATE_ASSOCIATION}${codeId}?framework=${frameworkObj.id}&category=${frameworkObj.category}`, requestBody);
  }

  publishFreamework(frameworkObj:any): Observable<any> {
    return this.http.post(`${API_ENDPOINT.PUBLISH_FRAMEWORK}${frameworkObj.id}`, {});
  }

  setLoaderState(isLoading: boolean) {
    this.loaderSubject.next(isLoading)
  }

  /** @deprecated org hierarchy uses unlinkOrgHierarchy; no longer called by the library */
  retireTerm(requestBody: any, frameworkObj:any): Observable<any> {
    return this.http.post(`${API_ENDPOINT.RETIRE_TREM}?framework=${frameworkObj.id}&category=${frameworkObj.category}`, requestBody);
  }

  orgContentUpdate(requestBody: any): Observable<any> {
    return this.http.patch(`${API_ENDPOINT.ORG_CONTENT_UPDATE}`, requestBody);
  }

  updateCategory(requestBody: any, frameworkObj:any): Observable<any> {
    return this.http.patch(`${API_ENDPOINT.UPDATE_CATEGORY}${frameworkObj.category}?framework=${frameworkObj.id}`, requestBody);
  }

  getUsersSearch(requestBody: any): Observable<any> {
    return this.http.post(`${API_ENDPOINT.USERS_SEARCH}`, requestBody);
  }

  /**
   * One page of the orgs at `level` under the L0 org `parentOrgId` that an org can be moved under.
   * `excludeOrgId` (the org being moved) and its sub-orgs are left out of the results.
   */
  lookupHierarchyOrgs(
    parentOrgId: string, level: number, excludeOrgId: string, page: number, query?: string,
  ): Observable<NSOrgHierarchy.IOrgLookupResult> {
    const searchText = (query || '').trim()
    const requestBody: NSOrgHierarchy.IOrgLookupRequest = {
      request: {
        filters: { parentOrgId, level, excludeOrgWithChildren: excludeOrgId },
        ...(searchText ? { query: searchText } : {}),
        page,
        limit: ORG_LOOKUP_PAGE_LIMIT,
      }
    }
    return this.http.post<NSOrgHierarchy.IOrgLookupResponse>(`${API_ENDPOINT.ORG_HIERARCHY_ORG_LOOKUP}`, requestBody).pipe(
      map((res: NSOrgHierarchy.IOrgLookupResponse) => {
        if (!this.isActionSuccess(res) || !res.result) {
          throw new Error((res && res.params && res.params.errmsg) || 'Failed to fetch organisations')
        }
        return res.result
      })
    )
  }

  /** Moves an org (with its sub-tree) under a new parent org (POST /org/v2/hierarchy/move) */
  moveOrgHierarchy(orgId: string, newParentOrgId: string): Observable<NSOrgHierarchy.IActionResponse> {
    const requestBody: NSOrgHierarchy.IMoveRequest = {
      request: { orgId, newParentOrgId }
    }
    return this.http.post<NSOrgHierarchy.IActionResponse>(`${API_ENDPOINT.ORG_HIERARCHY_MOVE}`, requestBody)
  }

}
