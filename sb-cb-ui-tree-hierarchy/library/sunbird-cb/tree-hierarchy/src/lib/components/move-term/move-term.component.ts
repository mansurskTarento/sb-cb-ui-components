import { Component, Inject, OnDestroy, OnInit } from '@angular/core'
import { FormControl } from '@angular/forms'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { MatSelect } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Subject, fromEvent, of } from 'rxjs'
import { catchError, debounceTime, finalize, map, switchMap, takeUntil } from 'rxjs/operators'
import _ from 'lodash'
import { NSOrgHierarchy } from '../../models/org-hierarchy.model'
import { ORG_LOOKUP_PAGE_LIMIT, TreeHierarchyService } from '../../tree-hierarchy.service'

interface ILookupPageRequest {
  level: number
  page: number
  query: string
}

interface ILookupPageResponse {
  req: ILookupPageRequest
  result?: NSOrgHierarchy.IOrgLookupResult
  error?: unknown
}

const SEARCH_DEBOUNCE_MS = 500
/** Distance (px) from the bottom of the dropdown at which the next page is requested */
const ORG_SCROLL_THRESHOLD = 50

@Component({
  selector: 'sb-cb-tree-move-term',
  templateUrl: './move-term.component.html',
  styleUrls: ['./move-term.component.scss'],
  standalone: false
})
export class MoveTermComponent implements OnInit, OnDestroy {
  /** Level of the new parent picked by the user; null until a level is selected */
  selectedLevel: number | null = null

  searchControl = new FormControl<string>('', { nonNullable: true })
  parentOrgControl = new FormControl<string | null>(null)

  /** Organisations of the selected level received for the current search (all loaded pages) */
  orgOptions: NSOrgHierarchy.IMoveOrg[] = []
  /** Options rendered in the select: the selected parent on top, then orgOptions */
  filteredOptions: NSOrgHierarchy.IMoveOrg[] = []
  /** Selected new parent; kept separately so it stays visible when the options are reset */
  selectedParent: NSOrgHierarchy.IMoveOrg | null = null

  /** Page / count of the last org-lookup response */
  orgPage = 0
  orgCount = 0
  /** Search text applied to the loaded organisations */
  orgSearchKey = ''
  isOrgsLoading = false
  isOrgPanelOpen = false
  isMoving = false

  private orgRequest$ = new Subject<ILookupPageRequest>()
  private orgPanelClose$ = new Subject<void>()
  private destroy$ = new Subject<void>()

  constructor(
    public dialogRef: MatDialogRef<MoveTermComponent, NSOrgHierarchy.IMoveDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: NSOrgHierarchy.IMoveDialogData,
    private treeHierarchySvc: TreeHierarchyService,
    private snackBar: MatSnackBar,
  ) { }

  ngOnInit() {
    this.orgRequest$
      .pipe(
        // a newer request (new search / level) drops the response of the previous one
        switchMap((req: ILookupPageRequest) => this.treeHierarchySvc
          .lookupHierarchyOrgs(this.rootOrgId, req.level, this.data.organisation.id, req.page, req.query)
          .pipe(
            map((result: NSOrgHierarchy.IOrgLookupResult): ILookupPageResponse => ({ req, result })),
            catchError((error: unknown) => of<ILookupPageResponse>({ req, error })),
            // responses arriving after the dropdown is closed are ignored
            takeUntil(this.orgPanelClose$),
          )),
        takeUntil(this.destroy$),
      )
      .subscribe((response: ILookupPageResponse) => this.onOrgsReceived(response))

    this.searchControl.valueChanges
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntil(this.destroy$))
      .subscribe((value: string) => {
        const query = (value || '').trim()
        if (!this.isOrgPanelOpen || query === this.orgSearchKey) {
          return
        }
        // new search: start again from page 0 with an empty list
        this.orgSearchKey = query
        this.orgOptions = []
        this.orgPage = 0
        this.orgCount = 0
        this.refreshOrgOptions()
        this.loadOrgs(0)
      })

    this.parentOrgControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((id: string | null) => {
        this.selectedParent = (id && this.filteredOptions.find(org => org.id === id)) || null
      })
  }

  ngOnDestroy() {
    this.orgPanelClose$.next()
    this.orgPanelClose$.complete()
    this.destroy$.next()
    this.destroy$.complete()
  }

  get rootOrgId(): string {
    return (this.data.rootOrg && this.data.rootOrg.id) || ''
  }

  get levels(): NSOrgHierarchy.ILevel[] {
    return (this.data && this.data.levels) || []
  }

  /** Deepest level allowed in the hierarchy (last tree column) */
  get maxLevel(): number {
    return this.levels.reduce((max, lvl) => Math.max(max, lvl.level), 0)
  }

  get hasMoreOrgs(): boolean {
    return (this.orgPage + 1) * ORG_LOOKUP_PAGE_LIMIT < this.orgCount
  }

  /** Confirm Move is enabled only once a new parent (other than the current one) is selected */
  get canMove(): boolean {
    return !!this.selectedParent && !this.isCurrentParent(this.selectedParent) && !this.isMoving
  }

  /**
   * A parent level is disabled when the org would go beyond the deepest level after the move.
   * An org with child orgs needs one more level below it for its children.
   */
  isLevelDisabled(lvl: NSOrgHierarchy.ILevel): boolean {
    const levelsNeeded = this.data.organisation.childCount ? 2 : 1
    return lvl.level + levelsNeeded > this.maxLevel
  }

  isCurrentParent(org: NSOrgHierarchy.IMoveOrg): boolean {
    return !!this.data.currentParent && this.data.currentParent.id === org.id
  }

  /** New level picked: the selected parent, options and search of the previous level are cleared */
  selectLevel(lvl: NSOrgHierarchy.ILevel) {
    if (this.isLevelDisabled(lvl) || this.selectedLevel === lvl.level) {
      return
    }
    this.selectedLevel = lvl.level
    this.orgPanelClose$.next()
    this.parentOrgControl.setValue(null)
    this.selectedParent = null
    this.orgOptions = []
    this.resetOrgSearchState()
    this.refreshOrgOptions()
  }

  /** Dropdown opened: load page 0. Closed: reset page, options and search (the selected parent is kept). */
  onParentSelectOpenedChange(opened: boolean, selectElement: MatSelect) {
    if (opened) {
      this.isOrgPanelOpen = true
      this.orgOptions = []
      this.resetOrgSearchState()
      this.refreshOrgOptions()
      this.loadOrgs(0)
      this.listenToOrgPanelScroll(selectElement)
    } else {
      this.isOrgPanelOpen = false
      this.orgPanelClose$.next()
      this.orgOptions = []
      this.resetOrgSearchState()
      // the closed select still needs the selected option to show its value
      this.refreshOrgOptions()
    }
  }

  loadNextOrgPage() {
    if (this.isOrgsLoading || !this.hasMoreOrgs) {
      return
    }
    this.loadOrgs(this.orgPage + 1)
  }

  /** Keeps Enter/Space inside the search box from selecting/closing the mat-select */
  handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
    }
    event.stopPropagation()
  }

  trackByLevel(_index: number, lvl: NSOrgHierarchy.ILevel): number {
    return lvl.level
  }

  trackByOrg(_index: number, org: NSOrgHierarchy.IMoveOrg): string {
    return org.id
  }

  onMove() {
    const newParent = this.selectedParent
    if (!this.canMove || !newParent) {
      return
    }
    this.isMoving = true
    this.treeHierarchySvc.moveOrgHierarchy(this.data.organisation.id, newParent.id)
      .pipe(
        finalize(() => { this.isMoving = false }),
        takeUntil(this.destroy$),
      )
      .subscribe(res => {
        if (!this.treeHierarchySvc.isActionSuccess(res)) {
          this.snackBar.open((res && res.params && res.params.errmsg) || 'Error in moving the organisation', 'cancel')
          return
        }
        this.snackBar.open('Organisation moved successfully')
        // the tree view reloads the hierarchy when the dialog closes with moved: true
        this.dialogRef.close({ moved: true, organisation: this.data.organisation, newParent, response: res })
      }, err => {
        console.error('Error in moving organisation', err)
        const errMsg = err && err.error && err.error.params && err.error.params.errmsg
        this.snackBar.open(errMsg || 'Error in moving the organisation', 'cancel')
      })
  }

  onClose() {
    this.dialogRef.close()
  }

  private loadOrgs(page: number) {
    if (this.selectedLevel === null) {
      return
    }
    this.isOrgsLoading = true
    this.orgRequest$.next({ level: this.selectedLevel, page, query: this.orgSearchKey })
  }

  private onOrgsReceived(response: ILookupPageResponse) {
    const { req, result, error } = response
    this.isOrgsLoading = false
    if (error || !result) {
      console.error('Error fetching organisations:', error)
      this.snackBar.open('Error in fetching organisations', 'cancel')
      return
    }
    const orgs: NSOrgHierarchy.IMoveOrg[] = (result.organizations || [])
      .map((org: NSOrgHierarchy.IOrgLookupOrg) => ({ id: org.id, name: org.name, level: org.level }))
    this.orgPage = req.page
    this.orgCount = result.count || 0
    // page 0 (open / new search) replaces the list, next pages are appended
    this.orgOptions = req.page === 0 ? orgs : _.uniqBy([...this.orgOptions, ...orgs], 'id')
    this.refreshOrgOptions()
  }

  /** Selected parent on top, followed by the loaded organisations */
  private refreshOrgOptions() {
    const selected = this.selectedParent
    this.filteredOptions = selected
      ? [selected, ...this.orgOptions.filter(org => org.id !== selected.id)]
      : [...this.orgOptions]
  }

  private resetOrgSearchState() {
    this.orgPage = 0
    this.orgCount = 0
    this.orgSearchKey = ''
    this.isOrgsLoading = false
    this.searchControl.setValue('', { emitEvent: false })
  }

  /** Requests the next page when the dropdown panel is scrolled to the end */
  private listenToOrgPanelScroll(selectElement: MatSelect) {
    const panel: HTMLElement | undefined = selectElement && selectElement.panel && selectElement.panel.nativeElement
    if (!panel) {
      return
    }
    fromEvent(panel, 'scroll')
      .pipe(takeUntil(this.orgPanelClose$), takeUntil(this.destroy$))
      .subscribe(() => {
        if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - ORG_SCROLL_THRESHOLD) {
          this.loadNextOrgPage()
        }
      })
  }
}
