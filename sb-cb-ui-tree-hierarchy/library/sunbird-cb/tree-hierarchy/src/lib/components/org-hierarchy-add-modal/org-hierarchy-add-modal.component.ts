import { Component, OnInit, Inject, OnDestroy } from '@angular/core'
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { FormControl } from '@angular/forms'
import { Subject, fromEvent, of } from 'rxjs'
import { catchError, debounceTime, map, switchMap, takeUntil } from 'rxjs/operators'
import { FrameworkService, UNMAPPED_ORGS_PAGE_LIMIT } from '../../services/framework.service'
import { NSOrgHierarchy } from '../../models/org-hierarchy.model'
import _ from 'lodash'
import { MatSelect } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'

/** Organisation option of the multi-select (shape consumed by linkOrganisations) */
interface IOrgOption {
  identifier: string
  orgName: string
  ministryOrStateId?: string
  ministryOrStateName?: string
}

interface IOrgPageRequest {
  page: number
  query: string
}

interface IOrgPageResponse {
  req: IOrgPageRequest
  result?: NSOrgHierarchy.IUnmappedOrgsResult
  error?: unknown
}

/** Distance (px) from the bottom of the dropdown at which the next page is requested */
const ORG_SCROLL_THRESHOLD = 50

@Component({
  selector: 'sb-cb-tree-org-hierarchy-add-modal',
  templateUrl: './org-hierarchy-add-modal.component.html',
  styleUrls: ['./org-hierarchy-add-modal.component.scss'],
  standalone: false
})
export class OrgHierarchyAddModalComponent implements OnInit, OnDestroy {
  searchControl = new FormControl('');
  selectedOrgsControl = new FormControl<(string | number)[]>([]);

  /** Organisations received from the unmapped-orgs API for the current search (all loaded pages) */
  orgOptions: IOrgOption[] = [];
  /** Options rendered in the select: selected organisations on top, then orgOptions */
  filteredOptions: IOrgOption[] = [];
  /** Organisations already added (selected and the dropdown closed / Add clicked) */
  addedOrgs: IOrgOption[] = [];
  /** Organisations selected while the dropdown is open; kept so that a new search does not lose them */
  selectedOrgs: IOrgOption[] = [];

  /** Page / count of the last unmapped-orgs response */
  orgPage = 0;
  orgCount = 0;
  /** Search text applied to the loaded organisations */
  orgSearchKey = '';
  isOrgsLoading = false;
  isOrgPanelOpen = false;
  /** Set when a page came back empty, so no more pages are requested even if count says otherwise */
  private orgsExhausted = false;
  private orgRequest$ = new Subject<IOrgPageRequest>();
  private orgPanelClose$ = new Subject<void>();

  private destroy$ = new Subject<void>();

  constructor(
    public dialogRef: MatDialogRef<OrgHierarchyAddModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private frameworkService: FrameworkService,
    private snackbar: MatSnackBar,
  ) { }

  ngOnInit() {
    this.orgRequest$
      .pipe(
        // a newer request (new search) drops the response of the previous one
        switchMap((req: IOrgPageRequest) =>
          this.frameworkService.getUnmappedOrgs(this.data?.selectedOrgData, {
            page: req.page,
            limit: UNMAPPED_ORGS_PAGE_LIMIT,
            query: req.query,
          }).pipe(
            map((result: NSOrgHierarchy.IUnmappedOrgsResult): IOrgPageResponse => ({ req, result })),
            catchError((error: unknown) => of<IOrgPageResponse>({ req, error })),
            // responses arriving after the dropdown is closed are ignored
            takeUntil(this.orgPanelClose$),
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe((response: IOrgPageResponse) => this.onOrgsReceived(response))

    this.searchControl.valueChanges
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe((value: any) => {
        const query = (value || '').trim()
        if (!this.isOrgPanelOpen || query === this.orgSearchKey) {
          return
        }
        this.orgSearchKey = query
        this.loadOrgs(0)
      })

    this.selectedOrgsControl.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((ids: (string | number)[] | null) => this.syncSelectedOrgs(ids || []))
  }

  ngOnDestroy() {
    this.orgPanelClose$.next()
    this.orgPanelClose$.complete()
    this.destroy$.next()
    this.destroy$.complete()
  }

  /** Dropdown opened: load page 0. Closed (also via Add): keep the selection as added and reset page / search. */
  onOrgSelectOpenedChange(opened: boolean, selectElement: MatSelect) {
    if (opened) {
      this.isOrgPanelOpen = true
      this.resetOrgSearchState()
      this.refreshOrgOptions()
      this.loadOrgs(0)
      this.listenToOrgPanelScroll(selectElement)
    } else {
      this.isOrgPanelOpen = false
      this.orgPanelClose$.next()
      this.addedOrgs = this.getSelectedOptions()
      this.selectedOrgs = []
      this.orgOptions = []
      this.resetOrgSearchState()
      // the closed select still needs the selected options to show its value
      this.filteredOptions = [...this.addedOrgs]
    }
  }

  get hasMoreOrgs(): boolean {
    return !this.orgsExhausted && (this.orgPage + 1) * UNMAPPED_ORGS_PAGE_LIMIT < this.orgCount
  }

  loadNextOrgPage() {
    if (this.isOrgsLoading || !this.hasMoreOrgs) {
      return
    }
    this.loadOrgs(this.orgPage + 1)
  }

  private loadOrgs(page: number) {
    this.isOrgsLoading = true
    this.orgRequest$.next({ page, query: this.orgSearchKey })
  }

  private onOrgsReceived(response: IOrgPageResponse) {
    const { req, result, error } = response
    this.isOrgsLoading = false
    if (error || !result) {
      console.error('Error fetching organisations:', error)
      this.snackbar.open('Error in fetching organisations')
      if (req.page === 0) {
        this.orgOptions = []
      }
      this.orgsExhausted = true
      this.refreshOrgOptions()
      return
    }
    const orgs = (result.organizations || []).map((org: NSOrgHierarchy.IUnmappedOrg) => this.toOrgOption(org))
    this.orgPage = typeof result.page === 'number' ? result.page : req.page
    this.orgCount = result.count || 0
    this.orgsExhausted = orgs.length === 0
    // page 0 (open / new search) replaces the list, next pages are appended
    this.orgOptions = req.page === 0 ? orgs : _.uniqBy([...this.orgOptions, ...orgs], 'identifier')
    this.refreshOrgOptions()
  }

  private toOrgOption(org: NSOrgHierarchy.IUnmappedOrg): IOrgOption {
    return {
      identifier: org.id,
      orgName: org.name,
      ministryOrStateId: org.ministryOrStateId,
      ministryOrStateName: org.ministryOrStateName,
    }
  }

  /** Selected (added + newly selected) organisations on top, followed by the loaded organisations */
  private refreshOrgOptions() {
    const selected = this.getSelectedOptions()
    const selectedIds = new Set(selected.map((org: IOrgOption) => org.identifier))
    this.filteredOptions = [
      ...selected,
      ...this.orgOptions.filter((org: IOrgOption) => !selectedIds.has(org.identifier)),
    ]
  }

  private resetOrgSearchState() {
    this.orgPage = 0
    this.orgCount = 0
    this.orgSearchKey = ''
    this.orgsExhausted = false
    this.isOrgsLoading = false
    this.searchControl.setValue('', { emitEvent: false })
  }

  /** Requests the next page when the dropdown panel is scrolled to the end */
  private listenToOrgPanelScroll(selectElement: MatSelect) {
    const panel: HTMLElement | undefined = selectElement?.panel?.nativeElement
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

  /** Keeps added / selected organisation objects in line with the select value */
  private syncSelectedOrgs(ids: (string | number)[]) {
    this.addedOrgs = this.addedOrgs.filter((org: IOrgOption) => ids.includes(org.identifier))
    const addedIds = this.addedOrgs.map((org: IOrgOption) => org.identifier)
    this.selectedOrgs = ids
      .filter((id: string | number) => !addedIds.includes(id as string))
      .map((id: string | number) => this.findOrg(id))
      .filter((org: IOrgOption | undefined): org is IOrgOption => !!org)
  }

  private findOrg(id: string | number): IOrgOption | undefined {
    const matches = (org: IOrgOption) => org.identifier === id
    return this.addedOrgs.find(matches)
      || this.selectedOrgs.find(matches)
      || this.orgOptions.find(matches)
      || this.filteredOptions.find(matches)
  }

  trackByOrg(_index: number, org: IOrgOption) {
    return org.identifier
  }

  clearSearch(event: Event) {
    event.stopPropagation()
    this.searchControl.setValue('')
  }

  toggleSelectAll(event: Event) {
    event.stopPropagation()
    if (this.isAllSelected()) {
      this.selectedOrgsControl.setValue([])
    } else {
      const allValues: any = this.filteredOptions.map(option => option.identifier)
      this.selectedOrgsControl.setValue(allValues)
    }
  }

  isAllSelected(): boolean {
    const numSelected = this.selectedOrgsControl.value?.length || 0
    const numFiltered = this.filteredOptions.length
    return numSelected > 0 && numSelected === numFiltered
  }

  /** Selected organisations (added + selected in the open dropdown), in selection order */
  getSelectedOptions(): IOrgOption[] {
    const selectedIds = this.selectedOrgsControl.value || []
    return selectedIds
      .map((id: string | number) => this.findOrg(id))
      .filter((org: IOrgOption | undefined): org is IOrgOption => !!org)
  }

  removeSelected(id: string | number) {
    const currentSelection = this.selectedOrgsControl.value || []
    this.selectedOrgsControl.setValue(
      currentSelection.filter((value: any) => value !== id)
    )
  }

  onClose() {
    this.dialogRef.close()
  }

  onSave() {
    const selectedOrgs = this.getSelectedOptions()
    if (!selectedOrgs.length) {
      this.snackbar.open('Please select at least one organization')
      return
    }
    this.dialogRef.close({ selectedOrg: selectedOrgs })
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      return false
    }
    return true
  }

  handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      return false
    }

    // For space, we only want to prevent default behavior when in the search input
    // but allow the event to propagate for selection functionality
    if (event.key === ' ' && event.target instanceof HTMLInputElement) {
      // Don't prevent propagation, just prevent default to allow typing spaces in search
      event.stopPropagation()
    }
    return true
  }

  checkAndClose(selectElement: MatSelect): void {
    if (!this.selectedOrgsControl.value || this.selectedOrgsControl.value.length === 0) {
      this.snackbar.open('Please select at least one organization')
    } else {
      selectElement.close()
    }
  }

  getNameOfOrg(id: any) {
    return this.findOrg(id)?.orgName || ''
  }

  removeOrg(itemToRemove: string): void {
    const currentValues = this.selectedOrgsControl.value || []
    const updatedValues = currentValues.filter(item => item !== itemToRemove)
    this.selectedOrgsControl.setValue(updatedValues)
  }
}
