// tslint:disable-next-line: no-namespace
export namespace NSOrgHierarchy {

  /** Request body for POST /org/v2/hierarchy/read/{orgId} */
  export interface IReadRequest {
    request: {
      /** search text; empty string when not searching */
      query: string
      limit: number
      offset: number
      countDescendants: boolean
      levelRequired: boolean
    }
  }

  export interface IResponseParams {
    resmsgid: string
    msgid: string
    err: string | null
    status: 'SUCCESS' | 'FAILED' | string
    errmsg: string | null
  }

  export interface IAssociation {
    id: string
    name: string
    idle?: boolean
    childCount?: number
    descendantCount?: number
    level?: number
  }

  /** Request body for POST /org/v2/hierarchy/link */
  export interface ILinkRequest {
    request: {
      parentOrgId: string
      associations: { childOrgId: string }[]
    }
  }

  /** Request body for POST /org/v2/hierarchy/unlink */
  export interface IUnlinkRequest {
    request: {
      orgId: string
      requireLeaf: boolean
    }
  }

  /** Request body for PATCH /org/v2/hierarchy/levels/{rootOrgId} */
  export interface IUpdateLevelsRequest {
    request: {
      levels: ILevel[]
    }
  }

  /** Response of link / unlink */
  export interface IActionResponse {
    id: string
    ver: string
    ts: string
    params: IResponseParams
    responseCode: string
    result?: { message?: string }
  }

  /** Org summary shown in the move dialog (organisation / current parent / move-to options) */
  export interface IMoveOrg {
    id: string
    name: string
    level?: number
    childCount?: number
    userCount?: number
  }

  /** Data passed to the move dialog */
  export interface IMoveDialogData {
    organisation: IMoveOrg
    currentParent: IMoveOrg | null
    /** Root org (state / ministry, L0) the hierarchy belongs to */
    rootOrg: IMoveOrg | null
    /** Hierarchy levels (tree columns) a new parent can be picked from */
    levels: ILevel[]
  }

  /** Value the move dialog closes with */
  export interface IMoveDialogResult {
    moved: boolean
    organisation: IMoveOrg
    newParent: IMoveOrg
    response: IActionResponse
  }

  /** Request body for POST /org/v2/hierarchy/move */
  export interface IMoveRequest {
    request: {
      orgId: string
      newParentOrgId: string
    }
  }

  /** Request body for POST /org/v2/hierarchy/org-lookup */
  export interface IOrgLookupRequest {
    request: {
      filters: {
        /** L0 (state / ministry) org id */
        parentOrgId: string
        level: number
        /** org that is left out of the results together with its sub-orgs */
        excludeOrgWithChildren: string
      }
      /** search text; sent only when searching */
      query?: string
      /** 0 based page index */
      page: number
      limit: number
    }
  }

  export interface IOrgLookupOrg {
    id: string
    name: string
    level?: number
    levelName?: string
  }

  export interface IOrgLookupResult {
    count: number
    page: number
    limit: number
    organizations: IOrgLookupOrg[]
  }

  export interface IOrgLookupResponse {
    id: string
    ver: string
    ts: string
    params: IResponseParams
    responseCode: string
    result?: IOrgLookupResult
  }

  /** Request body for POST /org/v2/hierarchy/unmapped-orgs */
  export interface IUnmappedOrgsRequest {
    request: {
      filters: {
        status: number
        ministryOrStateType: 'state' | 'ministry'
        ministryOrStateId: string
      }
      query: string
      /** 0 based page index */
      page: number
      limit: number
    }
  }

  /** Organisation of the ministry / state that is not part of the hierarchy yet */
  export interface IUnmappedOrg {
    id: string
    name: string
    ministryOrStateId?: string
    ministryOrStateName?: string
  }

  export interface IUnmappedOrgsResult {
    count: number
    page: number
    limit: number
    organizations: IUnmappedOrg[]
  }

  export interface IUnmappedOrgsResponse {
    id: string
    ver: string
    ts: string
    params: IResponseParams
    responseCode: string
    result?: IUnmappedOrgsResult
  }

  export interface ILevel {
    level: number
    name: string
    description?: string
  }

  export interface IReadResult extends IAssociation {
    associations?: IAssociation[]
    levels?: ILevel[]
    currentMaxLevel?: number
    maxAllowedLevel?: number
    limit?: number
    hasMore?: boolean
  }

  export interface IReadResponse {
    id: string
    ver: string
    ts: string
    params: IResponseParams
    responseCode: string
    result?: IReadResult
  }

  /** A hierarchy record formatted into the card/term shape the tree components already consume */
  export interface ITerm {
    identifier: string
    code: string
    name: string
    description: string
    category: string
    status: string
    idle: boolean
    level?: number
    childCount: number
    descendantCount?: number
    userCount: number
    selected: boolean
    children: ITerm[]
    additionalProperties: { orgId: string }
    cardRef?: any
  }

  /** Why a column's hierarchy state changed; lets the column view react appropriately */
  export type TColumnUpdateReason = 'reset' | 'loading' | 'load' | 'append' | 'search' | 'counts' | 'error'

  /** Pagination/search state of one column. A column always shows the children of a single parent. */
  export interface IColumnState {
    columnCode: string
    /** Org whose children are shown. Empty for a column that is not server-paged (child-org root card). */
    parentId: string
    /** Offset of the last successful page */
    offset: number
    /** Offset to request for the next page */
    nextOffset: number
    limit: number
    query: string
    hasMore: boolean
    isLoading: boolean
    /** Total children of the parent (unfiltered), used for column header counts */
    total: number
    records: ITerm[]
    /** true when the column holds a fixed record list (search stays client-side) */
    localOnly?: boolean
    error?: unknown
  }

  export interface IColumnEvent {
    state: IColumnState | null
    reason: TColumnUpdateReason
  }
}
