import { Injectable } from '@angular/core'
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs'
import { catchError, map, switchMap, takeUntil, tap } from 'rxjs/operators'
import { FRAMEWORK } from '../constants/data'
import { NSFramework } from '../models/framework.model'
import { NSOrgHierarchy } from '../models/org-hierarchy.model'
import { HttpClient } from '@angular/common/http'
import { v4 as uuidv4 } from 'uuid'
import { IConnection } from '../models/connection.model'
import { LocalConnectionService } from './local-connection.service'
/* tslint:disable */
import _ from 'lodash'
// import { TreeHierarchyService } from '../tree-hierarchy.service';
/* tslint:enable */

const API_ENDPOINT = {
  CREATE_TERMS: `/apis/proxies/v8/action/framework/v3/term/create`,
  UPDATE_TERMS: `/apis/proxies/v8/framework/v1/term/update/`,
  UPDATE_ASSOCIATION: `/apis/proxies/v8/framework/v1/term/update/`,
  PUBLISH_FRAMEWORK: `/apis/proxies/v8/framework/v1/publish/`,
  RETIRE_TREM: `/apis/proxies/v8/framework/v1/term/retire`,
  UPDATE_CATEGORY: `/apis/proxies/v8/framework/v1/category/update/`,
  USERS_SEARCH: `apis/proxies/v8/user/v1/search`,
  ORG_HIERARCHY_READ_V2: `/apis/proxies/v8/org/v2/hierarchy/read/`,
  ORG_HIERARCHY_UNMAPPED_ORGS: `/apis/proxies/v8/org/v2/hierarchy/unmapped-orgs`,
}

/** Page size requested from the unmapped organisations API */
export const UNMAPPED_ORGS_PAGE_LIMIT = 50

/** Page size requested from the org hierarchy v2 API */
export const HIERARCHY_PAGE_LIMIT = 20

interface NotifierType {
  type: 'select' | 'insert' | 'update' | 'delete'
  action: string
  data: any
}

type THierarchyRequestMode = 'load' | 'append' | 'search'

interface IHierarchyPageRequest {
  columnCode: string
  parentId: string
  offset: number
  limit: number
  query: string
  /** Parent's total child count, kept for header counts */
  total: number
  mode: THierarchyRequestMode
  /** Requests whose generation is no longer current for the column are ignored */
  generation: number
}

interface IHierarchyPageResponse {
  req: IHierarchyPageRequest
  result?: NSOrgHierarchy.IReadResult
  error?: unknown
}

@Injectable({
  providedIn: 'root'
})
export class FrameworkService {
  categoriesHash: BehaviorSubject<NSFramework.ICategory[] | []> = new BehaviorSubject<NSFramework.ICategory[] | []>([]);
  isDataUpdated: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  currentSelection: BehaviorSubject<{ type: string, data: any, cardRef?: any, isUpdate?: boolean } | null> =
    new BehaviorSubject<{ type: string, data: any, cardRef?: any, isUpdate?: boolean } | null>(null);
  termSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);
  afterAddOrEditSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);
  list = new Map<string, NSFramework.IColumnView>();
  selectionList = new Map<string, any>();
  insertUpdateDeleteNotifier: BehaviorSubject<NotifierType | null> = new BehaviorSubject<NotifierType | null>(null);
  environment: any
  libConfig!: IConnection
  frameworkId!: string
  rootConfig: any
  proxiesPath = 'apis/proxies/v8';
  cardClkData: any
  CurrentCardClk = new BehaviorSubject<any>(null);
  completeResponse: any
  /** User count per org id */
  private userCounts = new Map<string, number>();

  // ---- Org hierarchy (v2 API, server-side paging/search) ----
  /** true while the tree is driven by /org/v2/hierarchy/read instead of the framework read */
  isOrgHierarchyMode = false;
  private hierarchyStates = new Map<string, NSOrgHierarchy.IColumnState>();
  private hierarchyEvents = new Map<string, BehaviorSubject<NSOrgHierarchy.IColumnEvent | null>>();
  private hierarchyRequests = new Map<string, Subject<IHierarchyPageRequest>>();
  private hierarchyGenerations = new Map<string, number>();
  private hierarchyReset$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    public localConfig: LocalConnectionService,
    // private treeHierarchySvc: TreeHierarchyService
  ) { }

  getFrameworkInfo(_orgData?: any, _childOrgData?: any): Observable<any> {
    localStorage.removeItem('terms')
    this.isOrgHierarchyMode = false
    this.resetHierarchyState()
    if (this.localConfig.connectionType === 'online') {
      let url = `/${this.proxiesPath}/framework/v1/read/`
      if (_orgData) {
        url = url + _orgData.orgHierarchyFrameworkId
      } else {
        url = url + this.environment.frameworkName
      }
      return this.http.get(`${url}`, { withCredentials: true }).pipe(
        tap(async (response: any) => {
          this.resetAll()
          this.formateData(response, _orgData, _childOrgData)
          this.completeResponse = response.result.framework
        }),
        catchError((err) => {
          this.resetAll()
          this.list.clear()
          this.categoriesHash.next([])
          throw 'Error in source. Details: ' + err
        })
      )
    } else {
      this.resetAll()
      this.formateData(FRAMEWORK)
      return of(FRAMEWORK)
    }
  }

  readTerms(frameworkId: string, categoryId: string, requestBody: any): Observable<any> {
    return this.http.post(`/${this.proxiesPath}/framework/v1/term/search?framework=${frameworkId}&category=${categoryId}`, requestBody).pipe(
      map((res: any) => res.result))
  }

  createTerm(frameworkId: string, categoryId: string, requestBody: any): Observable<any> {
    return this.http.post(`/${this.proxiesPath}/framework/v1/term/create?framework=${frameworkId}&category=${categoryId}`, requestBody)
  }

  createTermsWrapper(category: string, requestBody: any): Observable<any> {
    let categoryItem: string
    if (category === 'theme') {
      categoryItem = 'competencyTheme'
    } else {
      categoryItem = 'competencySubTheme'
    }

    return this.http.post(`/${this.proxiesPath}/${categoryItem}/create/term`, requestBody)
      .pipe(map(res => _.get(res, 'result')))
  }

  retireTerm(frameworkId: string, categoryId: string, categoryTermCode: string): Observable<any> {
    return this.http.delete(`/${this.proxiesPath}/framework/v1/term/retire/${categoryTermCode}?framework=${frameworkId}&category=${categoryId}`)
  }

  retireMultipleTerm(frameworkId: string, categoryId: string, requestBody: any): Observable<any> {
    return this.http.post(`/${this.proxiesPath}/framework/v1/term/retire?framework=${frameworkId}&category=${categoryId}`, requestBody)
  }

  updateTerm(frameworkId: string, categoryId: string, categoryTermCode: string, requestBody: any): Observable<any> {
    return this.http.patch(`/${this.proxiesPath}/framework/v1/term/update/${categoryTermCode}?framework=${frameworkId}&category=${categoryId}`, requestBody)
  }

  publishFramework(): Observable<any> {
    return this.http.post(`/${this.proxiesPath}/framework/v1/publish/${this.environment.frameworkName}`, {})
  }

  getUuid(): string {
    return uuidv4()
  }

  updateEnvironment(env: any): void {
    this.environment = env
  }

  getEnviroment(): any {
    return this.environment
  }

  getFrameworkId(): string {
    return this.frameworkId
  }

  getNextCategory(currentCategory: string): NSFramework.ICategory | null {
    const currentIndex = this.categoriesHash.value.findIndex((a: NSFramework.ICategory) => {
      return a.code === currentCategory
    })
    let categoryLength = this.categoriesHash.getValue().length
    return (currentIndex + 1) < categoryLength ? this.categoriesHash.getValue()[currentIndex + 1] : null
  }

  getPreviousCategory(currentCategory: string): NSFramework.ICategory | null {
    const currentIndex = this.categoriesHash.value.findIndex((a: NSFramework.ICategory) => {
      return a.code === currentCategory
    })
    return (currentIndex - 1) >= 0 ? this.categoriesHash.getValue()[currentIndex - 1] : null
  }

  getParentTerm(currentCategory: string): any {
    const parent = this.getPreviousCategory(currentCategory) || null
    return parent ? this.selectionList.get(parent.code) : null
  }

  childClick(event: { type: string, data: any }): void {
    this.currentSelection.next(event)
  }

  resetAll(): void {
    this.categoriesHash.next([])
    this.currentSelection.next(null)
    this.selectionList.clear()
    this.list.clear()
  }

  isLastColumn(colCode: string): boolean {
    return this.categoriesHash.value && (this.categoriesHash.value.findIndex((a: NSFramework.ICategory) => {
      return a.code === colCode
    })) === (this.categoriesHash.value.length - 1)
  }

  removeItemFromArray(array: any[], item: any): any[] {
    /* assign a empty array */
    var tmp: any[] = []
    /* loop over all array items */
    for (var index in array) {
      if (array[index] !== item) {
        /* push to temporary array if not like item */
        tmp.push(array[index])
      }
    }
    /* return the temporary array */
    return tmp
  }

  set setTerm(res: any) {
    this.termSubject.next(res)
    let oldTerms = this.getTerm || []
    oldTerms.push(res)
    localStorage.setItem('terms', JSON.stringify(oldTerms))
  }

  get getTerm(): any[] {
    return JSON.parse(localStorage.getItem('terms') || '[]') || []
  }

  updateAfterAddOrEditSubject(res: any): void {
    if (res) {
      this.afterAddOrEditSubject.next(res)
    }
  }

  getLocalTermsByParent(parentCode: string): any[] {
    const filteredData = this.getTerm.filter(x => {
      return x.parent && x.parent.category === parentCode
    }) || []

    return filteredData.map(x => {
      return x.term
    })
  }

  getLocalTermsByCategory(parentCode: string): any[] {
    const filteredData = this.getTerm.filter(x => {
      return x.term && x.term.category === parentCode
    }) || []

    return filteredData
  }

  getLocalTermsCategory(category: string): any[] {
    const filteredData = this.getTerm.filter(x => {
      return x.category === category
    }) || []

    return filteredData
  }

  formateData(response: any, _orgData?: any, _childOrgData?: any): void {
    this.frameworkId = response.result.framework.code
    let categories = response.result.framework.categories
    if (_childOrgData?.id !== _orgData?.id) {
      categories = this.getOrgFromChildOnwards(categories || [], _childOrgData || '')
    }
    if (categories?.length > 0) {
      categories = _.sortBy(categories, 'index')
    }
    response.result.framework.categories = categories;
    (categories).forEach((a: any, _idx: number) => {
      this.list.set(a.code, {
        code: a.code || '',
        identifier: a.identifier,
        index: (_idx + 1),
        name: a.name,
        selected: a.selected,
        status: a.status as NSFramework.TNodeStatus,
        description: a.description,
        translations: a.translations,
        category: a.category,
        associations: a.associations,
        config: this.getConfig(a.code, _childOrgData),
        children: (a.terms || []).map((c: any) => {
          const associations = c.associations || []
          const tempCount = this.getUserCount(c)
          Object.assign(c, { userCount: tempCount })
          if (associations.length > 0) {
            Object.assign(c, { children: associations })
          }
          return c
        })
      })
    })

    const allCategories: NSFramework.ICategory[] = []
    this.list.forEach(a => {
      allCategories.push({
        code: a.code,
        identifier: a.identifier,
        index: a.index,
        name: a.name,
        status: a.status as NSFramework.TNodeStatus,
        description: a.description,
        translations: a.translations,
      } as NSFramework.ICategory)
    })
    this.categoriesHash.next(allCategories)
  }

  getOrgFromChildOnwards(_categories: any, _childOrgData: any) {
    const colIndexToBeRemoved: number[] = []
    let termFoundIndex: any = -1
    if (_categories?.length > 0) {
      _categories.forEach((ele: any) => {
        if (ele?.terms?.length > 0) {
          const termFound = ele.terms.find((term: any) => term.name === _childOrgData.channel)
          if (!termFound && termFoundIndex === -1) {
            colIndexToBeRemoved.push(ele.index)
          } else if (termFoundIndex === -1) {
            termFoundIndex = ele.index
            ele.terms = ele.terms.filter((term: any) => term.name === _childOrgData.channel)
          }
        }
      })
    }
    return _categories.filter((category: any) => !colIndexToBeRemoved.includes(category.index))
  }

  removeOldLine(): void {
    const eles = Array.from(document.getElementsByClassName('leader-line') || [])
    if (eles.length > 0) {
      eles.forEach(ele => ele.remove())
    }
  }

  setConfig(config: any): void {
    this.rootConfig = config
  }

  getConfig(code: string, _childOrgData?: any): any {
    let categoryConfig: any
    if (this.rootConfig && this.rootConfig[0]) {
      this.rootConfig.forEach((config: any) => {
        if (this.frameworkId == config.frameworkId) {
          categoryConfig = config.config.find((obj: any) => obj.category == code)
        }
      })
    }
    if (!categoryConfig) {
      const config = this.rootConfig.config[0]
      return config
    }
    return categoryConfig
  }

  getAllSelectedTerms(): any[] {
    const selectedTerms: any[] = []
    this.list.forEach(l => {
      if (l.children && l.children.length) {
        l.children.forEach(c => {
          if (c.selected) {
            selectedTerms.push(c)
          }
        })
      }
    })
    return selectedTerms
  }

  getPreviousSelectedTerms(code: string): any[] {
    let prevSelectedTerms: any[] = []
    this.selectionList.forEach(sl => {
      if (sl.category !== code) {
        prevSelectedTerms.push(sl)
      }
    })
    return prevSelectedTerms
  }

  getKcmSearchList(requestBody: any, category: string): Observable<any> {
    let categoryItem: string
    if (category === 'theme') {
      categoryItem = 'competencyTheme'
    } else {
      categoryItem = 'competencySubTheme'
    }

    return this.http.post(`/${this.proxiesPath}/${categoryItem}/search`, requestBody)
      .pipe(map(res => _.get(res, 'result.result')))
  }

  updateLocalList(item: any, parent: any, selectedTermArray: any[], updateType: string): void {
    if (item && item.children && item.children.length) {
      if (updateType === 'delete') {
        item.children.forEach((itmData: any) => {
          if (itmData.identifier === parent.identifier) {
            const associationList: any = _.differenceWith(itmData.associations, selectedTermArray, (a: any, b: any) => a.identifier === b.identifier)
            const childrenList: any = _.differenceWith(itmData.children, selectedTermArray, (a: any, b: any) => a.identifier === b.identifier)
            itmData['associations'] = associationList
            itmData['children'] = childrenList
          }
          if (itmData.children) {
            this.updateLocalList(itmData, parent, selectedTermArray, updateType)
          }
        })
      } else {
        item.children.forEach((itmData: any) => {
          if (itmData.identifier === parent.identifier) {
            let differenceData: any[] = []
            if (itmData && itmData.children && itmData.children.length) {
              differenceData = _.differenceBy(selectedTermArray, itmData.children, 'identifier')
            } else {
              differenceData = selectedTermArray
            }
            itmData['associations'] = itmData && itmData.associations ? [...itmData.associations, ...differenceData] : differenceData
            itmData['children'] = itmData && itmData.children ? [...itmData.children, ...differenceData] : differenceData
          }
          if (itmData.children) {
            this.updateLocalList(itmData, parent, selectedTermArray, updateType)
          }
        })
      }
    }
  }

  updateFrameworkList(columnCode: string, parentData: any, selectedTermArray: any[], updateType?: string): void {
    let listData: any = this.list.get(columnCode)
    if (updateType === 'delete') {
      const associationList: any = _.differenceWith(listData.associations, selectedTermArray, (a: any, b: any) => a.identifier === b.identifier)
      const childrenList: any = _.differenceWith(listData.children, selectedTermArray, (a: any, b: any) => a.identifier === b.identifier)
      listData['associations'] = associationList
      listData['children'] = childrenList

      this.selectionList.forEach((selectedData: any) => {
        let listData: any = this.list.get(selectedData.category)
        if (listData && listData.children && listData.children.length) {
          this.updateLocalList(listData, parentData, selectedTermArray, updateType)
        }
      })
    } else {
      let differenceData: any[] = []
      if (listData && listData.children && listData.children.length) {
        differenceData = _.differenceBy(selectedTermArray, listData.children, 'identifier')
      } else {
        differenceData = selectedTermArray
      }
      listData['associations'] = listData && listData.associations ? [...listData.associations, ...differenceData] : differenceData
      listData['children'] = listData && listData.children ? [...listData.children, ...differenceData] : differenceData

      this.selectionList.forEach((selectedData: any) => {
        let listData: any = this.list.get(selectedData.category)
        if (listData && listData.children && listData.children.length) {
          this.updateLocalList(listData, parentData, selectedTermArray, updateType || '')
        }
      })
    }
  }

  getFrameworkRead(frameWorkId: string): Observable<any> {
    if (this.localConfig.connectionType === 'online') {
      return this.http.get(`/${this.proxiesPath}/framework/v1/read/${frameWorkId}`, { withCredentials: true }).pipe(
        map((response: any) => _.get(response, 'result.framework'))
      )
    } else {
      return of({})
    }
  }

  getConfigOfCategoryConfigByFrameWorkId(code: string, frameworkId: string): any {
    let categoryConfig: any
    if (this.rootConfig && this.rootConfig[0]) {
      this.rootConfig.forEach((config: any) => {
        if (frameworkId == config.frameworkId) {
          categoryConfig = config.config.find((obj: any) => obj.category == code)
        }
      })
    }
    return categoryConfig
  }

  getConfigByFrameWorkId(frameworkId: string): any {
    let categoryConfig: any
    if (this.rootConfig && this.rootConfig[0]) {
      this.rootConfig.forEach((config: any) => {
        if (frameworkId == config.frameworkId) {
          categoryConfig = config
        }
      })
    }
    return categoryConfig
  }

  updateFullTermDataLocalMap(_columnCode: string, parentData: any): void {
    this.selectionList.forEach((selectedData: any) => {
      let listData: any = this.list.get(selectedData.category)
      if (listData && listData.children && listData.children.length) {
        this.updateLocalListTerm(listData, parentData)
      }
    })
  }

  updateLocalListTerm(item: any, parent: any): void {
    if (item && item.children && item.children.length) {
      item.children.forEach((itmData: any) => {
        if (itmData.identifier === parent.identifier) {
          itmData['description'] = parent['description']
          itmData['additionalProperties'] = parent['additionalProperties']
        }
        if (itmData.children) {
          this.updateLocalListTerm(itmData, parent)
        }
      })
    }
  }

  /**
   * POST /org/v2/hierarchy/unmapped-orgs - organisations of the selected ministry / state that are not in the
   * hierarchy yet. `page` is 0 based. Errors (HTTP or params.status !== SUCCESS) are thrown.
   */
  getUnmappedOrgs(orgData: any, page: { page: number, limit: number, query?: string }): Observable<NSOrgHierarchy.IUnmappedOrgsResult> {
    const body: NSOrgHierarchy.IUnmappedOrgsRequest = {
      request: {
        filters: {
          status: 1,
          // a centre (ministry) org is searched as 'ministry'
          ministryOrStateType: (orgData?.sbOrgType || '').toLowerCase() === 'state' ? 'state' : 'ministry',
          ministryOrStateId: orgData?.identifier || orgData?.rootOrgId || '',
        },
        query: (page.query || '').trim(),
        page: page.page,
        limit: page.limit,
      },
    }
    return this.http.post<NSOrgHierarchy.IUnmappedOrgsResponse>(`${API_ENDPOINT.ORG_HIERARCHY_UNMAPPED_ORGS}`, body).pipe(
      map((res: NSOrgHierarchy.IUnmappedOrgsResponse) => {
        if (!res || (res.params?.status || '').toUpperCase() !== 'SUCCESS' || !res.result) {
          throw new Error(res?.params?.errmsg || 'Failed to fetch organisations')
        }
        return res.result
      })
    )
  }

  getUserCount(term: any): number {
    const orgId = term?.additionalProperties?.orgId
    return (orgId && this.userCounts.get(orgId)) || 0
  }

  // ===========================================================================
  // Org hierarchy (v2) - progressive loading, per-column pagination and search
  // ===========================================================================

  /** POST /org/v2/hierarchy/read/{orgId}. Errors (HTTP or params.status !== SUCCESS) are thrown. */
  readOrgHierarchy(orgId: string, page: { offset: number, limit: number, query?: string }, levelRequired = false): Observable<NSOrgHierarchy.IReadResult> {
    const body: NSOrgHierarchy.IReadRequest = {
      request: {
        query: (page.query || '').trim(),
        limit: page.limit,
        offset: page.offset,
        countDescendants: false,
        levelRequired: levelRequired,
      }
    }
    return this.http.post<NSOrgHierarchy.IReadResponse>(`${API_ENDPOINT.ORG_HIERARCHY_READ_V2}${encodeURIComponent(orgId)}`, body).pipe(
      map((res: NSOrgHierarchy.IReadResponse) => {
        if (!res || (res.params?.status || '').toUpperCase() !== 'SUCCESS' || !res.result) {
          throw new Error(res?.params?.errmsg || 'Failed to read organisation hierarchy')
        }
        return res.result
      })
    )
  }

  /**
   * Initial load of the org hierarchy tree. Builds the columns from `levels` and fills the first column.
   * For a child org admin the tree starts at the child org (same as the old getOrgFromChildOnwards behaviour).
   */
  loadOrgHierarchy(orgData: any, childOrgData?: any): Observable<NSOrgHierarchy.IReadResult> {
    localStorage.removeItem('terms')
    // cancel what the current tree is loading; the tree itself stays visible until the new data arrives
    this.cancelHierarchyRequests()
    const childOrgId = this.getChildOrgId(orgData, childOrgData)
    const rootId: string = childOrgId || orgData?.identifier || orgData?.id || ''
    return this.readOrgHierarchy(rootId, { offset: 0, limit: HIERARCHY_PAGE_LIMIT }, true).pipe(
      tap((result: NSOrgHierarchy.IReadResult) => {
        this.resetAll()
        this.resetHierarchyState()
        this.isOrgHierarchyMode = true
        this.completeResponse = null
        this.frameworkId = orgData?.orgHierarchyFrameworkId || ''
        this.buildHierarchyColumns(result, rootId, !!childOrgId)
      }),
      catchError((err) => {
        this.resetAll()
        this.list.clear()
        this.categoriesHash.next([])
        return throwError(err)
      })
    )
  }

  /**
   * Re-reads the hierarchy of the L0 org and applies the returned level names/descriptions to the tree columns
   * (e.g. after a level was renamed). Only the column headers change; loaded records and selections are kept.
   */
  refreshLevelNames(l0OrgId: string): Observable<NSOrgHierarchy.ILevel[]> {
    return this.readOrgHierarchy(l0OrgId, { offset: 0, limit: 1 }, true).pipe(
      map((result: NSOrgHierarchy.IReadResult) => result.levels || []),
      tap((levels: NSOrgHierarchy.ILevel[]) => this.applyLevelNames(levels))
    )
  }

  /** Updates the name/description of each column whose level is in `levels` */
  applyLevelNames(levels: NSOrgHierarchy.ILevel[]): void {
    if (!this.isOrgHierarchyMode || !levels || !levels.length) {
      return
    }
    let changed = false
    this.list.forEach((column: NSFramework.IColumnView) => {
      const lvl = levels.find(l => l && l.level === column.level)
      if (lvl && lvl.name && (lvl.name !== column.name || lvl.description !== column.description)) {
        column.name = lvl.name
        column.description = lvl.description
        changed = true
      }
    })
    if (changed) {
      this.categoriesHash.next(this.categoriesHash.value.map((cat: NSFramework.ICategory) => {
        const column = this.list.get(cat.code)
        return column ? { ...cat, name: column.name, description: column.description } : cat
      }))
    }
  }

  /** Event stream (current value replayed) for one column's hierarchy state */
  hierarchyColumnEvents$(columnCode: string): Observable<NSOrgHierarchy.IColumnEvent | null> {
    return this.getHierarchyEventSubject(columnCode).asObservable()
  }

  getHierarchyColumnState(columnCode: string): NSOrgHierarchy.IColumnState | null {
    return this.hierarchyStates.get(columnCode) || null
  }

  /** true when the column fetches pages/search results from the server */
  isServerPagedColumn(columnCode: string): boolean {
    const state = this.hierarchyStates.get(columnCode)
    return this.isOrgHierarchyMode && !(state && state.localOnly)
  }

  /**
   * A card was selected in `columnCode`: load its children (offset 0) into the next column and clear the
   * columns after it. Re-selecting the same parent keeps the loaded pages and the current search.
   */
  selectHierarchyParent(columnCode: string, term: any): void {
    if (!this.isOrgHierarchyMode || !term) {
      return
    }
    const next = this.getNextCategory(columnCode)
    if (!next) {
      return
    }
    this.getColumnCodesAfter(next.code).forEach(code => this.resetHierarchyColumn(code))
    const parentId = String(term.identifier || term.code || '')
    const current = this.hierarchyStates.get(next.code)
    if (!parentId) {
      this.resetHierarchyColumn(next.code)
      return
    }
    if (current && current.parentId === parentId && !current.error) {
      return
    }
    const query = current ? current.query : ''
    const total = Number(term.childCount) || 0
    const state: NSOrgHierarchy.IColumnState = {
      ...this.createEmptyHierarchyState(next.code),
      parentId,
      query,
      total,
    }
    if (typeof term.childCount === 'number' && term.childCount === 0) {
      // Nothing under this org - no request needed; the column shows the existing empty state
      this.bumpHierarchyGeneration(next.code)
      this.setHierarchyState(next.code, state, 'load')
      return
    }
    this.setHierarchyState(next.code, { ...state, isLoading: true }, 'loading')
    this.requestHierarchyPage({ columnCode: next.code, parentId, offset: 0, query, total, mode: 'load' })
  }

  /** Server-side search within a column: offset resets to 0 and results replace the column's records */
  searchHierarchyColumn(columnCode: string, query: string): boolean {
    const state = this.hierarchyStates.get(columnCode)
    if (!state || state.localOnly || !state.parentId) {
      return false
    }
    const trimmed = (query || '').trim()
    // previous records stay visible until the new results arrive
    this.hierarchyStates.set(columnCode, { ...state, query: trimmed, isLoading: true, error: undefined })
    this.requestHierarchyPage({ columnCode, parentId: state.parentId, offset: 0, query: trimmed, total: state.total, mode: 'search' })
    return true
  }

  /** Loads the next page of a column; ignored while a request is pending or when there is nothing more */
  loadNextHierarchyPage(columnCode: string): boolean {
    const state = this.hierarchyStates.get(columnCode)
    if (!state || state.localOnly || !state.parentId || !state.hasMore || state.isLoading) {
      return false
    }
    this.hierarchyStates.set(columnCode, { ...state, isLoading: true, error: undefined })
    this.requestHierarchyPage({
      columnCode, parentId: state.parentId, offset: state.nextOffset, query: state.query, total: state.total, mode: 'append'
    })
    return true
  }

  /** Clears one column's records and pagination state and discards its pending request */
  resetHierarchyColumn(columnCode: string): void {
    this.bumpHierarchyGeneration(columnCode)
    const hadState = this.hierarchyStates.delete(columnCode)
    const column = this.list.get(columnCode)
    if (column && this.isOrgHierarchyMode) {
      column.children = []
    }
    if (hadState) {
      this.emitHierarchyEvent(columnCode, 'reset')
    }
  }

  /** Clears all hierarchy state and cancels every pending hierarchy/user-count request */
  resetHierarchyState(): void {
    this.cancelHierarchyRequests()
    this.hierarchyStates.clear()
    this.hierarchyGenerations.clear()
    this.hierarchyEvents.forEach(subject => subject.complete())
    this.hierarchyEvents.clear()
  }

  /** Cancels every pending hierarchy page / user-count request */
  private cancelHierarchyRequests(): void {
    this.hierarchyReset$.next()
    this.hierarchyRequests.clear()
  }

  /** Framework category code behind a tree column (columns are built from hierarchy levels) */
  getFrameworkCategoryCode(columnCode: string): string {
    if (!this.isOrgHierarchyMode) {
      return columnCode
    }
    const column = this.list.get(columnCode)
    const categories: any[] = this.completeResponse?.categories || []
    if (!column || !categories.length) {
      return columnCode
    }
    for (const record of column.children || []) {
      const term = this.findFrameworkTermByOrgId(record?.additionalProperties?.orgId)
      if (term && term.category) {
        return term.category
      }
    }
    const category = categories[column.index - 1]
    return (category && category.code) || columnCode
  }

  /** Framework term for a hierarchy record (matched by org id); returns the record itself when not found */
  toFrameworkTerm(record: any): any {
    if (!this.isOrgHierarchyMode || !record) {
      return record
    }
    const preferredCategory = record.category ? this.getFrameworkCategoryCode(record.category) : ''
    const term = this.findFrameworkTermByOrgId(record?.additionalProperties?.orgId, preferredCategory)
    return term ? { ...term, cardRef: record.cardRef } : record
  }

  private findFrameworkTermByOrgId(orgId: string, preferredCategory?: string): any {
    const categories: any[] = this.completeResponse?.categories || []
    if (!orgId || !categories.length) {
      return null
    }
    const ordered = preferredCategory
      ? [...categories.filter(c => c.code === preferredCategory), ...categories.filter(c => c.code !== preferredCategory)]
      : categories
    for (const category of ordered) {
      const term = (category.terms || []).find((t: any) => t?.additionalProperties?.orgId === orgId)
      if (term) {
        return term
      }
    }
    return null
  }

  private getChildOrgId(orgData: any, childOrgData: any): string {
    const childId = childOrgData?.id || childOrgData?.identifier
    const rootId = orgData?.id || orgData?.identifier
    return childId && rootId && childId !== rootId ? String(childId) : ''
  }

  private buildHierarchyColumns(result: NSOrgHierarchy.IReadResult, rootId: string, isChildRoot: boolean): void {
    const associations = result.associations || []
    const firstLevel = isChildRoot
      ? (result.level ?? 1)
      : (associations[0]?.level ?? ((result.level ?? 0) + 1))
    const maxLevel = result.maxAllowedLevel
    let levels: NSOrgHierarchy.ILevel[] = _.sortBy((result.levels || []).filter((l: NSOrgHierarchy.ILevel) =>
      l && typeof l.level === 'number' && l.level >= firstLevel && (!maxLevel || l.level <= maxLevel)), 'level')
    if (!levels.length) {
      levels = [{ level: firstLevel, name: `Level ${firstLevel}` }]
    }
    levels.forEach((lvl: NSOrgHierarchy.ILevel, idx: number) => {
      const code = `level${lvl.level}`
      this.list.set(code, {
        code,
        identifier: code,
        index: idx + 1,
        name: lvl.name,
        selected: false,
        status: 'live',
        description: lvl.description,
        translations: null,
        category: code,
        associations: '',
        config: this.getConfig(code),
        children: [],
        level: lvl.level,
        hasData: typeof result.currentMaxLevel !== 'number' || lvl.level <= result.currentMaxLevel,
      })
    })
    this.categoriesHash.next(Array.from(this.list.values()).map(c => ({
      code: c.code,
      identifier: c.identifier,
      index: c.index,
      name: c.name,
      status: c.status,
      description: c.description,
    } as NSFramework.ICategory)))

    const columns = Array.from(this.list.values())
    const page = { parentId: rootId, offset: 0, limit: HIERARCHY_PAGE_LIMIT, query: '', total: Number(result.childCount) || 0 }
    if (isChildRoot) {
      // The child org itself is the only card of the first column; its children come with the same response
      const rootTerm = this.toHierarchyTerm(result, columns[0].code)
      this.setHierarchyState(columns[0].code, {
        ...this.createEmptyHierarchyState(columns[0].code), records: [rootTerm], total: 1, localOnly: true,
      }, 'load')
      this.loadUserCounts([rootTerm])
      if (columns[1]) {
        this.applyHierarchyPage({ ...page, columnCode: columns[1].code, mode: 'load', generation: 0 }, result)
      }
    } else {
      this.applyHierarchyPage({ ...page, columnCode: columns[0].code, mode: 'load', generation: 0 }, result)
    }
  }

  /** Formats a v2 hierarchy record into the term/card shape used by the tree components */
  private toHierarchyTerm(record: NSOrgHierarchy.IAssociation, columnCode: string): NSOrgHierarchy.ITerm {
    const id = String(record.id)
    return {
      identifier: id,
      code: id,
      name: record.name || '',
      description: '',
      category: columnCode,
      status: 'Live',
      idle: !!record.idle,
      level: record.level,
      childCount: Number(record.childCount) || 0,
      descendantCount: record.descendantCount,
      userCount: this.userCounts.get(id) || 0,
      selected: false,
      children: [],
      additionalProperties: { orgId: id },
    }
  }

  private createEmptyHierarchyState(columnCode: string): NSOrgHierarchy.IColumnState {
    return {
      columnCode,
      parentId: '',
      offset: 0,
      nextOffset: 0,
      limit: HIERARCHY_PAGE_LIMIT,
      query: '',
      hasMore: false,
      isLoading: false,
      total: 0,
      records: [],
    }
  }

  private requestHierarchyPage(page: Omit<IHierarchyPageRequest, 'generation' | 'limit'>): void {
    const req: IHierarchyPageRequest = {
      ...page,
      limit: HIERARCHY_PAGE_LIMIT,
      generation: this.bumpHierarchyGeneration(page.columnCode),
    }
    this.getHierarchyRequestStream(page.columnCode).next(req)
  }

  /** One request stream per column; switchMap cancels the previous in-flight request of that column */
  private getHierarchyRequestStream(columnCode: string): Subject<IHierarchyPageRequest> {
    let stream = this.hierarchyRequests.get(columnCode)
    if (!stream) {
      stream = new Subject<IHierarchyPageRequest>()
      this.hierarchyRequests.set(columnCode, stream)
      stream.pipe(
        switchMap((req: IHierarchyPageRequest) => this.readOrgHierarchy(req.parentId, req).pipe(
          map((result): IHierarchyPageResponse => ({ req, result })),
          catchError((error): Observable<IHierarchyPageResponse> => of({ req, error }))
        )),
        takeUntil(this.hierarchyReset$)
      ).subscribe((response: IHierarchyPageResponse) => this.handleHierarchyResponse(response))
    }
    return stream
  }

  private handleHierarchyResponse({ req, result, error }: IHierarchyPageResponse): void {
    if (this.hierarchyGenerations.get(req.columnCode) !== req.generation) {
      return // stale: the column was reset, re-parented or re-searched meanwhile
    }
    const state = this.hierarchyStates.get(req.columnCode)
    if (!state) {
      return
    }
    if (error || !result) {
      console.error('error in fetching organisation hierarchy', error)
      // offset/hasMore stay unchanged so the same page can be requested again
      this.setHierarchyState(req.columnCode, { ...state, isLoading: false, error: error || true }, 'error')
      return
    }
    this.applyHierarchyPage(req, result)
  }

  private applyHierarchyPage(req: Omit<IHierarchyPageRequest, 'limit'> & { limit: number }, result: NSOrgHierarchy.IReadResult): void {
    const state = this.hierarchyStates.get(req.columnCode) || this.createEmptyHierarchyState(req.columnCode)
    const seen = new Set<string>(req.mode === 'append' ? state.records.map(r => r.identifier) : [])
    const incoming: NSOrgHierarchy.ITerm[] = [];
    (result.associations || []).forEach((assoc: NSOrgHierarchy.IAssociation) => {
      if (assoc && assoc.id !== undefined && assoc.id !== null && !seen.has(String(assoc.id))) {
        seen.add(String(assoc.id))
        incoming.push(this.toHierarchyTerm(assoc, req.columnCode))
      }
    })
    const records = req.mode === 'append' ? [...state.records, ...incoming] : incoming
    const pageSize = Number(result.limit) > 0 ? Number(result.limit) : req.limit
    const total = req.query ? req.total : (Number(result.childCount) || req.total || 0)
    this.setHierarchyState(req.columnCode, {
      ...state,
      parentId: req.parentId,
      query: req.query,
      offset: req.offset,
      nextOffset: req.offset + pageSize,
      limit: req.limit,
      hasMore: !!result.hasMore,
      isLoading: false,
      error: undefined,
      localOnly: false,
      total,
      records,
    }, req.mode)
    this.loadUserCounts(incoming)
  }

  private setHierarchyState(columnCode: string, state: NSOrgHierarchy.IColumnState, reason: NSOrgHierarchy.TColumnUpdateReason): void {
    this.hierarchyStates.set(columnCode, state)
    const column = this.list.get(columnCode)
    if (column) {
      column.children = state.records
    }
    this.emitHierarchyEvent(columnCode, reason)
  }

  private emitHierarchyEvent(columnCode: string, reason: NSOrgHierarchy.TColumnUpdateReason): void {
    this.getHierarchyEventSubject(columnCode).next({ state: this.hierarchyStates.get(columnCode) || null, reason })
  }

  private getHierarchyEventSubject(columnCode: string): BehaviorSubject<NSOrgHierarchy.IColumnEvent | null> {
    let subject = this.hierarchyEvents.get(columnCode)
    if (!subject) {
      subject = new BehaviorSubject<NSOrgHierarchy.IColumnEvent | null>(null)
      this.hierarchyEvents.set(columnCode, subject)
    }
    return subject
  }

  private bumpHierarchyGeneration(columnCode: string): number {
    const generation = (this.hierarchyGenerations.get(columnCode) || 0) + 1
    this.hierarchyGenerations.set(columnCode, generation)
    return generation
  }

  private getColumnCodesAfter(columnCode: string): string[] {
    const codes = this.categoriesHash.value.map((c: NSFramework.ICategory) => c.code)
    const index = codes.indexOf(columnCode)
    return index === -1 ? [] : codes.slice(index + 1)
  }

  /**
   * User counts for newly loaded records (same user search + rootOrgId facet as before, limited to the
   * page's org ids). On failure the cards keep showing 0, as before.
   */
  private loadUserCounts(terms: NSOrgHierarchy.ITerm[]): void {
    const orgIds: string[] = _.uniq(terms.map(t => t.additionalProperties.orgId).filter(id => !!id && !this.userCounts.has(id)))
    if (!orgIds.length) {
      return
    }
    const requestBody = {
      request: {
        filters: { rootOrgId: orgIds },
        fields: ['identifier', 'rootOrgId'],
        limit: 1,
        facets: ['rootOrgId'],
        sort_by: { createdDate: 'desc' },
      }
    }
    this.http.post(`${API_ENDPOINT.USERS_SEARCH}`, requestBody).pipe(
      catchError(error => {
        console.error('Error fetching user count data:', error)
        return of(null)
      }),
      takeUntil(this.hierarchyReset$)
    ).subscribe((res: any) => {
      if (!res) {
        return
      }
      const counts = this.parseUserCountFacets(res, orgIds)
      counts.forEach((count, id) => this.userCounts.set(id, count))
      this.hierarchyStates.forEach((state, columnCode) => {
        let changed = false
        state.records.forEach(record => {
          const count = this.userCounts.get(record.additionalProperties.orgId)
          if (count !== undefined && record.userCount !== count) {
            record.userCount = count
            changed = true
          }
        })
        if (changed) {
          this.emitHierarchyEvent(columnCode, 'counts')
        }
      })
    })
  }

  private parseUserCountFacets(res: any, orgIds: string[]): Map<string, number> {
    const counts = new Map<string, number>(orgIds.map(id => [id, 0]))
    if (res && res.result && res.result.response && res.result.response.count) {
      const facets: any[] = res.result.response.facets || []
      const orgFacet = facets.find((facet: any) => facet.name === 'rootOrgId')
      if (orgFacet && orgFacet.values) {
        orgFacet.values.forEach((value: any) => {
          if (counts.has(value.name)) {
            counts.set(value.name, value.count || 0)
          }
        })
      }
    }
    return counts
  }
}