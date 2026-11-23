import { Component, Input, OnInit, Output, EventEmitter, OnDestroy, ChangeDetectorRef } from '@angular/core'
import { FrameworkService } from '../../services/framework.service'
import { MatDialog } from '@angular/material/dialog'
import { CreateTermComponent } from '../create-term/create-term.component'
import { ConnectorComponent } from '../connector/connector.component'
import { LocalConnectionService } from '../../services/local-connection.service'
import { IConnectionType } from '../../models/connection-type.model'
import { Subject, Subscription } from 'rxjs'
import { filter, take, takeUntil, tap } from 'rxjs/operators'
import { ConnectorService } from '../../services/connector.service'
import { ApprovalService } from '../../services/approval.service'
import { MatSnackBar } from '@angular/material/snack-bar'
import { defaultConfig, headerLineConfig } from '../../constants/app-constant'
import { labels } from '../../labels/strings'
import { Card } from '../../models/variable-type.model'
import { CreateTermFromFrameworkComponent } from '../create-term-from-framework/create-term-from-framework.component'
import { OrgHierarchyAddModalComponent } from '../org-hierarchy-add-modal/org-hierarchy-add-modal.component'
import { TreeHierarchyService } from '../../tree-hierarchy.service'
import { ConforamtionPopupComponent } from '../conforamtion-popup/conforamtion-popup.component'
import { CategoryEditModuleComponent } from '../category-edit/category-edit-module/category-edit-module.component'
import { MoveTermComponent } from '../move-term/move-term.component'
import { NSOrgHierarchy } from '../../models/org-hierarchy.model'
import _ from 'lodash'

declare var LeaderLine: any

/** Wait before reloading the tree after a hierarchy change (same as after the framework publish) */
const HIERARCHY_REFRESH_DELAY_MS = 5000
@Component({
    selector: 'lib-tree-view',
    templateUrl: './tree-view.component.html',
    styleUrls: ['./tree-view.component.scss'],
    standalone: false
})
export class TreeViewComponent implements OnInit, OnDestroy {
  @Input() approvalList: Array<Card> = [];
  @Input() isApprovalView: boolean = false;
  @Input() workFlowStatus: string = '';
  @Input() environment: any
  @Input() taxonomyConfig: any
  @Input() orgSelectedData: any
  @Input() childOrgData: any
  @Input() userRolesData: any
  @Output() sentForApprove = new EventEmitter<any>()
  @Output() loaderEnable = new EventEmitter<any>()
  @Output() manageOrg = new EventEmitter<any>()
  mapping = {};
  heightLighted = []
  localList = []
  showPublish: boolean = false
  newTermSubscription: Subscription | undefined = undefined
  loaded: any = {}
  showActionBar: boolean = false
  approvalRequiredTerms = []
  draftTerms: Array<Card> = [];
  isLoading: boolean = false;
  categoryList: any = [];
  app_strings: any = labels;
  isHideBtnEna: boolean = true;
  columnId: string = '';
  configCodeBtn: any
  dataConfig: any
  isFraworkLoading = true
  loaderSubscription!: Subscription
  private afterAddOrEditSubscription: Subscription | undefined
  private cardClickSubscription: Subscription | undefined
  /** Org ids of the selected cards (in column order) to select again once the tree has reloaded */
  private pendingSelectionPath: string[] = []
  /** Cancels a running selection restore */
  private restoreSelection$ = new Subject<void>()
  constructor(private frameworkService: FrameworkService,
    private localSvc: LocalConnectionService,
    public dialog: MatDialog,
    private approvalService: ApprovalService,
    private _snackBar: MatSnackBar,
    private connectorSvc: ConnectorService,
    private cdr: ChangeDetectorRef,
    private treeHierarchySvc: TreeHierarchyService,
    private changeDetector: ChangeDetectorRef,
  ) { }

  ngOnInit() {
    this.draftTerms = this.approvalList
    this.init()
    this.showActionBar = this.isApprovalView ? true : false
    this.afterAddOrEditSubscription = this.frameworkService.afterAddOrEditSubject.subscribe(responseData => {
      if (responseData && responseData.res && responseData.data) {
        this.refreshData(responseData)
      }
    })
    this.isEnableds()
  }

  ngOnChanges() {

  }

  ngAfterContentChecked(): void {
    this.cdr.detectChanges()
  }

  init() {
    this.initConfig()
    // Org hierarchy trees load progressively from /org/v2/hierarchy/read; other trees keep the framework read
    const source$ = this.isOrgHierarchyEnabled()
      ? this.frameworkService.loadOrgHierarchy(this.orgSelectedData, this.childOrgData)
      : this.frameworkService.getFrameworkInfo((this.orgSelectedData) ? this.orgSelectedData : '', (this.childOrgData) ? this.childOrgData : '')
    const selectionPath = this.pendingSelectionPath
    this.pendingSelectionPath = []
    this.restoreSelection$.next()
    source$.subscribe(() => {
      this.connectorSvc.removeAllLines()
      this.frameworkService.categoriesHash.value.forEach((cat: any) => {
        this.loaded[cat.code] = true
      })
      this.isLoading = false
      setTimeout(() => {
        if (selectionPath.length && this.frameworkService.isOrgHierarchyMode) {
          this.restoreSelectionPath(selectionPath)
        } else {
          this.makeFirstTermSelected()
        }
      }, 500)
    }, (err) => {
      console.error('error in fetching framework', err)
    })

    if (this.loaderSubscription) {
      this.loaderSubscription.unsubscribe()
    }
    this.loaderSubscription = this.treeHierarchySvc.loaderState$.subscribe(
      data => {
        this.loaderEnable.emit(data)
        this.changeDetector.detectChanges()
      },
    )

  }

  /** The org hierarchy (selected org with an org hierarchy framework) is served by the v2 hierarchy API */
  private isOrgHierarchyEnabled(): boolean {
    return !!(this.orgSelectedData && this.orgSelectedData.orgHierarchyFrameworkId &&
      (this.orgSelectedData.identifier || this.orgSelectedData.id) &&
      this.localSvc.connectionType === 'online')
  }

  refreshData(resData: any) {
    const res = resData.res
    if (res && res.created) {
      this.showPublish = true
    }
    if (res.multi && Array.isArray(res.term) && res.term.length) {
      res.term = res.term[0]
    }
    this.loaded[res.term.category] = false
    // wait
    const parentColumn = this.frameworkService.getPreviousCategory(res.term.category)
    res.parent = null
    if (parentColumn) {
      res.parent = this.frameworkService.selectionList.get(parentColumn.code)
      if (resData.type === 'update') {

        res.parent.children[res.parent.children.findIndex((el: any) => el.identifier === res.term.identifier)] = res.term
        // this.frameworkService.list.get(res.parent.category).children = [...res.parent.children]



        // this.frameworkService.currentSelection.next({ type: res.term.category, data: res.term.children, cardRef:resData.cardRef })
        // this.updateSelection(res.term.category, res.term.code);
        // this.updateSelection(res.parent.category, res.parent.code);
        // setTimeout(() => {
        //   this.frameworkService.currentSelection.next({ type: res.term.category, data: res.term.children, cardRef:resData.cardRef })
        // }, 100);
        // this.updateFinalList({ selectedTerm: res.term, isSelected: true, parentData: res.parent, colIndex:resData.index })
        this.loaded[res.term.category] = true
        res.term.selected = false
        this.frameworkService.selectionList.delete(res.term.category)
        this.frameworkService.insertUpdateDeleteNotifier.next({ action: res.term.category, type: 'update', data: res.term })
        this.updateFinalList({ selectedTerm: res.term, isSelected: true, parentData: res.parent, colIndex: resData.index }, 'update')
        res.term.selected = true
        // const next = this.frameworkService.getNextCategory(res.term.category)

        //   if (next && next.code) {
        //     this.frameworkService.selectionList.delete(next.code)
        //   }
      } else {
        if (!res.multi) {
          res.parent.children ? res.parent.children.push(res.term) : res.parent['children'] = [res.term]
        }
        this.updateFinalList({ selectedTerm: res.term, isSelected: false, parentData: res.parent, colIndex: resData.index },)
      }
    }

  }

  makeFirstTermSelected() {
    const firstListItem = this.frameworkService.list.entries().next().value as any
    if (firstListItem && firstListItem.length >= 2) {
      if (firstListItem[1] && firstListItem[1].children && firstListItem[1].children.length) {
        const firstTerm = firstListItem[1].children[0] as any
        const cardRef = document.getElementById(firstTerm.name)
        // this.categoryList = []
        firstTerm.selected = true
        this.frameworkService.cardClkData = firstTerm
        this.frameworkService.CurrentCardClk.next(firstTerm.category)
        this.frameworkService.currentSelection.next({ type: firstTerm.category, data: firstTerm, cardRef })
        this.isFraworkLoading = false
      }
    }
  }

  updateTaxonomyTerm(data: { selectedTerm: any, isSelected: boolean, isUpdate?: any }) {
    if (data && data.selectedTerm && data.selectedTerm.category) {
      if (!data.isUpdate) {
        this.updateFinalList(data)
      } else {
        this.updateFinalList(data, 'update')
      }
      this.updateSelection(data.selectedTerm.category, data.selectedTerm.code)
    }
  }
  updateSelection(category: string, selectedTermCode: string) {
    const categoryData = this.frameworkService.list.get(category)
    if (categoryData && categoryData.children) {
      categoryData.children.map(item => {
        item.selected = selectedTermCode === item.code ? true : false
        return item
      })
    }
  }

  //need to refactor at heigh level
  updateFinalList(data: { selectedTerm: any, isSelected: boolean, parentData?: any, colIndex?: any }, type?: any) {

    if (data.isSelected) {
      // data.selectedTerm.selected = data.isSelected
      this.frameworkService.selectionList.set(data.selectedTerm.category, data.selectedTerm)
      const next = this.frameworkService.getNextCategory(data.selectedTerm.category)
      if (next && next.code) {
        this.frameworkService.selectionList.delete(next.code)
      }
      // org hierarchy: fetch the selected card's children for the next column (no-op for framework trees)
      this.frameworkService.selectHierarchyParent(data.selectedTerm.category, data.selectedTerm)
      // notify next
      this.frameworkService.insertUpdateDeleteNotifier.next({ action: data.selectedTerm.category, type: type ? type : 'select', data: data.selectedTerm })
    }
    if (data.colIndex === 0 && !data.isSelected) {
      this.isLoading = true
      setTimeout(() => {
        this.init()
      }, 3000)
    }
    setTimeout(() => {
      this.loaded[data.selectedTerm.category] = true
      // if(type && type === 'update'){
      //   this.frameworkService.selectionList.delete(data.selectedTerm.category);
      //   this.frameworkService.currentSelection.next({ type: data.parentData.category, data: data.parentData.children })
      // }
    }, 100)

  }
  isEnabled(columnCode: string): boolean {
    return !!this.frameworkService.selectionList.get(columnCode)
  }

  isEnableds() {
    //  return this.frameworkService.cardClkData
    if (this.frameworkService.CurrentCardClk) {
      this.cardClickSubscription = this.frameworkService.CurrentCardClk.subscribe((item) => {
        const dataCode: any = this.frameworkService.getNextCategory(item)
        if (dataCode && dataCode.code) {
          this.dataConfig = this.frameworkService.getConfig(dataCode.code)
        }
        if (dataCode) {
          this.configCodeBtn = dataCode.code
        }
      })
    }


  }

  // getbtnEnableFn(_item: any) {
  //   const allSelectedTerm: any = this.frameworkService.getAllSelectedTerms()
  //   if (allSelectedTerm && allSelectedTerm.length && allSelectedTerm.filter((t: any) => t.category === _item.code).length > 0) {
  //     return true
  //   }
  //   return false
  // }


  openCreateTermDialog(column: any, colIndex: any) {
    if (!this.isEnabled(column.code)) {
      const nextCat = column.code
      const nextNextCat = this.frameworkService.getNextCategory(nextCat)
      if (nextCat) {
        const selectedTerms = this.frameworkService.getPreviousSelectedTerms(nextCat)
        const colInfo = Array.from(this.frameworkService.list.values()).filter(l => l.code === nextCat)
        let nextColInfo: any = []
        if (nextNextCat && nextNextCat.code) {
          nextColInfo = Array.from(this.frameworkService.list.values()).filter(l => l.code === nextNextCat.code)
        }
        let dialog: any
        if (this.environment && this.environment.frameworkType === 'MDO_DESIGNATION') {
          dialog = this.dialog.open(CreateTermFromFrameworkComponent, {
            data: {
              mode: 'multi-create',
              // cardColInfo: this.data.columnInfo,
              columnInfo: colInfo && colInfo.length ? colInfo[0] : [],
              nextColInfo: nextColInfo && nextColInfo.length ? nextColInfo[0] : [],
              frameworkId: this.frameworkService.getFrameworkId(),
              selectedparents: this.heightLighted,
              colIndex: nextCat.index,
              // childrenData: data.children,
              selectedParentTerms: selectedTerms
            },
            width: '800px',
            panelClass: 'custom-dialog-container',
            position: { top: '50px' }
          })
        } else {
          dialog = this.dialog.open(CreateTermComponent, {
            // data: {
            //   mode:'create',
            //   columnInfo: column,
            //   frameworkId: this.frameworkService.getFrameworkId(),
            //   selectedparents: this.heightLighted,
            //   colIndex: colIndex,
            //   selectedParentTerms: selectedTerms
            // },
            data: {
              mode: 'multi-create',
              columnInfo: colInfo && colInfo.length ? colInfo[0] : [],
              frameworkId: this.frameworkService.getFrameworkId(),
              selectedparents: this.heightLighted,
              colIndex: nextCat.index,
              // childrenData: data.children,
              selectedParentTerms: selectedTerms
            },
            width: '800px',
            panelClass: 'custom-dialog-container',
            position: { top: '50px' }
          })
        }
        dialog.afterClosed().subscribe((res: any) => {
          if (!res) {
            return
          }

          if (res && res.created) {
            this.showPublish = true
          }
          const data = this.frameworkService.cardClkData

          const responseData = {
            res,
            index: nextCat.index,
            data,
            type: 'multi-create'
          }
          if (!(res && res.stopUpdate)) {
            this.frameworkService.updateAfterAddOrEditSubject(responseData)
          }


          this.loaded[res.term.category] = false
          // wait
          const parentColumn = this.frameworkService.getPreviousCategory(res.term[0].category)
          res.parent = null
          if (parentColumn) {
            res.parent = this.frameworkService.selectionList.get(parentColumn.code)
            res.parent.children ? res.parent.children.push(res.term[0]) : res.parent['children'] = [res.term[0]]
          }
          this.updateFinalList({ selectedTerm: res.term[0], isSelected: false, parentData: res.parent, colIndex: colIndex })
        })
      }
    }
  }

  openOrganizationDialog(column: any, _index: any, typeSelected: string) {
    this.runWithOrgEditContext(() => this.openOrganizationDialogWithContext(column, typeSelected))
  }

  /**
   * Edit actions need the framework terms (code/identifier/associations) and the ministry/state org list.
   * In org hierarchy mode these are not part of the page load, so they are fetched here on first use.
   */
  private runWithOrgEditContext(action: () => void) {
    if (!this.orgSelectedData) {
      action()
      return
    }
    this.treeHierarchySvc.setLoaderState(true)
    this.frameworkService.ensureOrgEditContext(this.orgSelectedData).subscribe({
      next: () => {
        this.treeHierarchySvc.setLoaderState(false)
        action()
      },
      error: (err: any) => {
        console.error('error in fetching framework', err)
        this.treeHierarchySvc.setLoaderState(false)
        this._snackBar.open('Error in loading organisation hierarchy', 'cancel')
      },
    })
  }

  /** Selected cards of the other columns, as framework terms */
  private getPreviousSelectedTermsForEdit(columnCode: string): any[] {
    return this.frameworkService.getPreviousSelectedTerms(columnCode).map((term: any) => this.frameworkService.toFrameworkTerm(term))
  }

  /** Column info carrying the framework category code (what the edit APIs and dialogs expect) */
  private getColumnForEdit(column: any): any {
    if (!this.frameworkService.isOrgHierarchyMode || !column) {
      return column
    }
    return { ...column, code: this.frameworkService.getFrameworkCategoryCode(column.code) }
  }

  private openOrganizationDialogWithContext(column: any, typeSelected: string) {
    const treeListData = this.getPreviousSelectedTermsForEdit(column.code)
    const dialog = this.dialog.open(OrgHierarchyAddModalComponent, {
      data: {
        previous: treeListData,
        currentData: this.getColumnForEdit(column),
        selectedOrgData: this.orgSelectedData,
        type: typeSelected
      },
      autoFocus: true,
      restoreFocus: true,
      position: { right: '0' },
      height: '100vh',
      width: '50%',
      panelClass: 'right-side-modal',
      maxWidth: '100vw'
    })

    dialog.afterClosed().subscribe(async (_res: any) => {
      if (_res && _res.type === 'add') {
        this.linkOrganisations(_res.selectedOrg, column)
      } else if (_res && _res.type === 'update') {
        if (_res.paparentSelectedOrg) {
          // moving the card under another parent still uses the framework term association + publish
          await this.updateParentAssociation(_res.paparentSelectedOrg, _res.currentTerm)
        }
        if (_res.selectedOrg && _res.selectedOrg.length > 0) {
          // a changed parent is a framework edit that still needs the publish after linking
          this.linkOrganisations(_res.selectedOrg, column, !!_res.paparentSelectedOrg)
        } else {
          this.publishFramework({
            id: this.orgSelectedData.orgHierarchyFrameworkId || '',
            category: ''
          })
        }
      }
    })
  }

  get list(): any[] {
    return Array.from(this.frameworkService.list.values())
  }

  drawHeaderLine(len: number) {
    const options = { ...defaultConfig, ...headerLineConfig }
    for (let i = 1; i <= len; i++) {
      const startEle = document.querySelector(`#box${i}count`)
      const endEle = document.querySelector(`#box${i}Header`)
      if (startEle && endEle) {
        new LeaderLine(startEle, endEle, options)
      }
    }
  }

  getColumn(columnCode: string) {
    return this.frameworkService.list.get(columnCode)
  }

  newConnection() {
    const dialog = this.dialog.open(ConnectorComponent, {
      data: {},
      width: '90%',
      // panelClass: 'custom-dialog-container'
    })
    dialog.afterClosed().subscribe((res: IConnectionType) => {
      if ((res.source === 'online' && res.data.endpoint) || (res.source === 'offline')) {
        this.localSvc.localStorage = res
        this.init()
      } else if (res.source === 'online' && !res.data.endpoint) {
        this.localSvc.localStorage = res
        this.init()
      }
    })
  }

  updateDraftStatusTerms(event: any) {
    if (event.checked) {
      this.draftTerms.push(event.term)
    } else {
      this.draftTerms = this.draftTerms.filter(d => event.term.identifier !== d.identifier)
    }
    this.showActionBar = this.draftTerms.length > 0 ? true : false
  }

  getNoOfCards(event: any) {
    if (this.categoryList.length > 0 && event.category !== '') {
      let index = this.categoryList.findIndex((obj: any) => obj.category == event.category)
      if (index > -1) {
        this.categoryList.splice(index)
      }
    }
    if (event.category == '') {
      this.categoryList[this.categoryList.length - 1].count = 0
    }
    this.categoryList.push(event)
  }

  getCount(code: string): number {
    // Get all previous categories to determine if they have selections
    const allCategories = Array.from(this.frameworkService.list.values())
    const currentCategoryIndex = allCategories.findIndex(cat => cat.code === code)

    // Check if all previous categories have selected terms
    for (let i = 0; i < currentCategoryIndex; i++) {
      const prevCategoryCode = allCategories[i].code
      const hasPrevSelection = this.frameworkService.selectionList.has(prevCategoryCode)

      // If any previous category doesn't have a selection, return 0
      if (!hasPrevSelection) {
        return 0
      }
    }

    // Now we can calculate the actual count since all previous levels are selected
    let count = 0

    // Check if there's a selected term for parent category that has children for this category
    const prevCategory = this.frameworkService.getPreviousCategory(code)

    if (this.frameworkService.isOrgHierarchyMode) {
      // Only a page of children is loaded, so the totals come from the API's childCount
      if (prevCategory) {
        const prevSelected = this.frameworkService.selectionList.get(prevCategory.code)
        return prevSelected ? (Number(prevSelected.childCount) || 0) : 0
      }
      const state = this.frameworkService.getHierarchyColumnState(code)
      return state ? state.total : 0
    }
    if (prevCategory) {
      const prevSelectedTerm = this.frameworkService.selectionList.get(prevCategory.code)
      if (prevSelectedTerm) {
        // If we have a selected parent term, count its children for this category
        if (prevSelectedTerm.children && prevSelectedTerm.children.length > 0) {
          count = prevSelectedTerm.children.filter((child: any) =>
            !child.isDeleted && child.status !== 'Retired' &&
            (child.category === code || (child.associations &&
              child.associations.some((assoc: any) => assoc.category === code)))
          ).length

          return count
        }
      }

      // If no selection exists for the parent, don't show counts
      return 0
    }

    // If this is the first level, we can show all terms
    const categoryData = this.frameworkService.list.get(code)
    if (categoryData && categoryData.children) {
      count = categoryData.children.filter((child: any) =>
        !child.isDeleted && child.status !== 'Retired'
      ).length
    }

    return count
  }

  /** Count shown in the first column header */
  getFirstColumnCount(column: any): number {
    if (this.frameworkService.isOrgHierarchyMode) {
      const state = this.frameworkService.getHierarchyColumnState(column.code)
      return state ? state.total : 0
    }
    return column && column.children ? column.children.length : 0
  }

  /** Whether the column view (search box + cards) is rendered for a column */
  hasColumnContent(column: any): boolean {
    if (!column) {
      return false
    }
    const hasChildren = !!(column.children && column.children.length > 0)
    if (!this.frameworkService.isOrgHierarchyMode) {
      return hasChildren
    }
    // Same as before: a level that holds orgs keeps its column view (search box) even when the current
    // parent has none; and it stays while a search is active so the query can be cleared
    const state = this.frameworkService.getHierarchyColumnState(column.code)
    return hasChildren || column.hasData !== false || !!(state && state.query)
  }

  sendForApproval() {
    if (!this.isApprovalView) {
      let parentList: any = []
      this.list.forEach(ele => {
        const t = ele.children.filter((term: any) => term.selected === true)
        if (t[0]) {
          parentList.push(t[0])
        }
      })
      const req = {
        updateFieldValues: [...parentList, ...this.draftTerms]
      }
      this.approvalService.createApproval(req).subscribe(() => {
        this.frameworkService.removeOldLine()
        this._snackBar.open('Terms successfully sent for Approval.', 'cancel')
      })
    } else {
      this.sentForApprove.emit(this.draftTerms)
    }

  }

  closeActionBar(_e: any) {
    this.showActionBar = false
  }

  initConfig() {
    if (this.environment) {
      this.frameworkService.updateEnvironment(this.environment)
      this.frameworkService.setConfig(this.taxonomyConfig)
    }
  }

  ngOnDestroy() {
    this.restoreSelection$.next()
    this.restoreSelection$.complete()
    this.frameworkService.removeOldLine()
    if (this.loaderSubscription) {
      this.loaderSubscription.unsubscribe()
    }
    if (this.afterAddOrEditSubscription) {
      this.afterAddOrEditSubscription.unsubscribe()
    }
    if (this.cardClickSubscription) {
      this.cardClickSubscription.unsubscribe()
    }
    if (this.frameworkService.isOrgHierarchyMode) {
      // cancel pending hierarchy / user-count requests
      this.frameworkService.resetHierarchyState()
    }
    // this.environment = null
    // this.frameworkService.resetAndFresh()
    // this.connectorSvc.removeAllLines()
    // this.connectorSvc.updateConnectorsMap({})
  }

  getNextCat(data: any) {
    if (data && data.code) {
      const nextCat = this.frameworkService.getNextCategory(data.code)
      return nextCat
    }
    return null
  }

  isCurrentOrNextTerm(_column: any, index: number): boolean {
    // If there's no current selection, only enable the first column
    if (!this.frameworkService.currentSelection.value) {
      return index === 0
    }

    // Get the current selected category from the currentSelection
    const currentCategory = this.frameworkService.currentSelection.value.type
    if (!currentCategory) {
      return index === 0
    }

    // Find the index of the current active column
    let currentIndex = -1
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].code === currentCategory) {
        currentIndex = i
        break
      }
    }

    // If we couldn't find the current index, only enable the first column
    if (currentIndex === -1) {
      return index === 0
    }

    // Enable the current column and the next one
    return index === currentIndex || index === currentIndex + 1
  }

  shouldShowSvgBorderWrapper(column: any, index: number): boolean {
    if (this.isCurrentOrNextTerm(column, index) && this.getCount(column.code) === 0) {
      return true
    }
    return false
  }

  /**
   * Links the selected orgs under their parent (POST /org/v2/hierarchy/link).
   * Parent = card selected in the previous column, or the root org for the first column
   * (same parent the old term create + association update used).
   */
  linkOrganisations(selectedList: any[], column: any, publishAfterLink = false) {
    const parentOrgId = this.getLinkParentOrgId(column)
    const childOrgIds: string[] = _.uniq((selectedList || []).map((org: any) => org && org.identifier).filter((id: any) => !!id))
    if (!parentOrgId || !childOrgIds.length) {
      this._snackBar.open('Error in creating term', 'cancel')
      return
    }
    this.treeHierarchySvc.setLoaderState(true)
    this.treeHierarchySvc.linkOrgHierarchy(parentOrgId, childOrgIds).subscribe((res: any) => {
      if (!this.treeHierarchySvc.isActionSuccess(res)) {
        this.onHierarchyActionError('Error in creating term', res)
        return
      }
      if (publishAfterLink) {
        this.publishFramework({ id: this.orgSelectedData.orgHierarchyFrameworkId || '', category: '' })
      } else {
        this.refreshAfterHierarchyChange()
      }
    }, (err: any) => {
      console.error('Error in linking organisation', err)
      this.onHierarchyActionError('Error in creating term', err && err.error)
    })
  }

  /** Org id under which new orgs of `column` are linked */
  private getLinkParentOrgId(column: any): string {
    const prev = column && this.frameworkService.getPreviousCategory(column.code)
    if (prev) {
      return this.getOrgIdOfTerm(this.frameworkService.selectionList.get(prev.code))
    }
    return (this.orgSelectedData && (this.orgSelectedData.identifier || this.orgSelectedData.id)) || ''
  }

  /** Org id of a card: hierarchy records and framework terms both carry additionalProperties.orgId */
  private getOrgIdOfTerm(term: any): string {
    if (!term) {
      return ''
    }
    const orgId = term.additionalProperties && term.additionalProperties.orgId
    return orgId || (this.frameworkService.isOrgHierarchyMode ? (term.identifier || '') : '')
  }

  /**
   * Same feedback as after a framework publish: message, loader off, reload the tree.
   * With `keepSelection` the cards selected before the reload are selected again (as far as they still exist).
   * An empty `message` skips the snackbar (e.g. the move dialog already showed one).
   */
  private refreshAfterHierarchyChange(keepSelection = false, message = 'Organization hierarchy updated successfully') {
    setTimeout(() => {
      if (message) {
        this._snackBar.open(message)
      }
      this.treeHierarchySvc.setLoaderState(false)
      this.pendingSelectionPath = keepSelection ? this.getSelectedOrgPath() : []
      this.init()
    }, HIERARCHY_REFRESH_DELAY_MS)
  }

  /** Org ids of the selected cards from the first column up to the deepest selected column */
  private getSelectedOrgPath(): string[] {
    const path: string[] = []
    for (const column of Array.from(this.frameworkService.list.values())) {
      const orgId = this.getOrgIdOfTerm(this.frameworkService.selectionList.get(column.code))
      if (!orgId) {
        break
      }
      path.push(orgId)
    }
    return path
  }

  /**
   * Selects the cards of `path` again, column by column. Each column is waited on until its records
   * (loaded for the card selected in the previous column) are in; further pages are loaded when the card
   * is not in the loaded ones. Stops at the first card that no longer exists (e.g. the moved org).
   */
  private restoreSelectionPath(path: string[], index = 0, parentId = '') {
    const column = Array.from(this.frameworkService.list.values())[index]
    const orgId = path[index]
    if (!column || !orgId) {
      return
    }
    const findRecord = (event: NSOrgHierarchy.IColumnEvent) =>
      (event.state ? event.state.records : []).find((record: any) => this.getOrgIdOfTerm(record) === orgId)

    this.frameworkService.hierarchyColumnEvents$(column.code).pipe(
      // records of this column loaded for the selected parent (the first column has no selected parent)
      filter((event): event is NSOrgHierarchy.IColumnEvent => !!event && !!event.state && !event.state.isLoading &&
        (event.reason === 'load' || event.reason === 'append') && (!parentId || event.state.parentId === parentId)),
      tap(event => {
        if (!findRecord(event) && event.state && event.state.hasMore) {
          this.frameworkService.loadNextHierarchyPage(column.code)
        }
      }),
      filter(event => !!findRecord(event) || !(event.state && event.state.hasMore)),
      take(1),
      takeUntil(this.restoreSelection$),
    ).subscribe(event => {
      const record = findRecord(event)
      if (!record) {
        if (index === 0) {
          this.makeFirstTermSelected()
        }
        return
      }
      // give the column time to render the card so the connectors can be drawn from it
      setTimeout(() => {
        this.selectHierarchyCard(record)
        this.restoreSelectionPath(path, index + 1, String(record.identifier || record.code || ''))
      }, 100)
    })
  }

  /** Selects a card the same way makeFirstTermSelected does */
  private selectHierarchyCard(term: any) {
    term.selected = true
    this.frameworkService.cardClkData = term
    this.frameworkService.CurrentCardClk.next(term.category)
    this.frameworkService.currentSelection.next({ type: term.category, data: term, cardRef: document.getElementById(term.name) })
  }

  private onHierarchyActionError(defaultMessage: string, res?: any) {
    this.treeHierarchySvc.setLoaderState(false)
    const serverMessage = res && res.params && res.params.errmsg
    this._snackBar.open(serverMessage || defaultMessage, 'cancel')
  }

  publishFramework(frameworkData: any) {
    this.treeHierarchySvc.publishFreamework(frameworkData).subscribe((res: any) => {
      if (res && res.result && res.result.publishStatus) {
        setTimeout(() => {
          this._snackBar.open(`Organization hierarchy updated successfully`)
          this.treeHierarchySvc.setLoaderState(false)
          this.init()
        }, 5000)
      } else {
        this._snackBar.open('Error in publishing framework', 'cancel')
        this.treeHierarchySvc.setLoaderState(false)
      }
    }, (err) => {
      console.error('Error in publishing framework', err)
      this.treeHierarchySvc.setLoaderState(false)
    })
  }

  removeConnection(data: any) {
    this.runWithOrgEditContext(() => this.removeConnectionWithContext(data))
  }

  private removeConnectionWithContext(data: any) {
    const term = this.frameworkService.toFrameworkTerm(data.children)
    const association = this.getSelectedTermsAssociation(term && term.code)
    let count = 0
    if (association && association.length > 0) {
      association.forEach((assoc: any) => {
        if (assoc.ids && assoc.ids.length > 0) {
          count += assoc.ids.length
        }
      })
    }
    if (count > 0) {
      const dialogData = {
        dialogType: 'warning',
        descriptions: [
          {
            header: `${count || 0} Organisation${count > 1 ? 's' : ''} will be removed from organisation hierarchy.`,
            headerClass: 'flex items-center justify-center text-blue',
            messages: [
              {
                msgClass: 'text-blue margin-bottom-s',
                msg: `Do you want to proceed?`,
              },
            ],
          },
        ],
        footerClass: 'items-center justify-center',
        buttons: [
          {
            btnText: 'No',
            btnClass: 'btn-common btn-secondary',
            response: false,
          },
          {
            btnText: 'Yes',
            btnClass: 'btn-common btn-primary',
            response: true,
          },
        ],
      }
      const dialogRef = this.dialog.open(ConforamtionPopupComponent, {
        data: dialogData,
        autoFocus: false,
        width: '600px',
        maxWidth: '80vw',
        maxHeight: '90vh',
        disableClose: true,
      })
      dialogRef.afterClosed().subscribe((res: any) => {
        if (res) {
          this.unlinkOrganisation(data.children)
        }
      })
    } else {
      this._snackBar.open(`Error in removing the organisation`, 'cancel')
    }
  }

  /** Removes the org and its sub-tree from the hierarchy (POST /org/v2/hierarchy/unlink, requireLeaf=false) */
  async unlinkOrganisation(card: any) {
    const orgId = this.getOrgIdOfTerm(card)
    if (!orgId) {
      this._snackBar.open(`Failed to remove connection.`, 'cancel')
      return
    }
    this.treeHierarchySvc.setLoaderState(true)
    const unlinkRes: any = await this.treeHierarchySvc.unlinkOrgHierarchy(orgId, false).toPromise().catch((err: any) => {
      console.error('Error in unlinking organisation', err)
      return err && err.error
    })
    if (!this.treeHierarchySvc.isActionSuccess(unlinkRes)) {
      this.onHierarchyActionError('Failed to remove connection.', unlinkRes)
      return
    }
    this.refreshAfterHierarchyChange()
  }

  cardActionEmit(event: any) {
    switch (event.action) {
      case 'remove-term':
        this.removeConnection(event.data)
        break
      case 'update-hierarchy':
        this.openOrganizationDialog(this.list[this.list.findIndex((item: any) => item.code === event.data.category) + 1], '', 'update')
        break
      case 'manage-org':
        this.manageOrg.emit(event.data.children)
        break
      case 'move-term':
        this.openMovepopup(event.data)
        break
    }
  }

  /** Last response of the move dialog */
  moveDialogResponse: NSOrgHierarchy.IMoveDialogResult | undefined

  /** Opens the move dialog for the clicked card; `cardData` is the term-card data ({ children: term, category, index, ... }) */
  openMovepopup(cardData: any) {
    const term = cardData && cardData.children
    const orgId = this.getOrgIdOfTerm(term)
    if (!orgId) {
      this._snackBar.open('Error in moving the organisation', 'cancel')
      return
    }
    const level = term.level || cardData.index
    // parent = card selected in the previous column, or the root org for the first column
    const prevCategory = this.frameworkService.getPreviousCategory(cardData.category)
    const parentTerm = prevCategory ? this.frameworkService.selectionList.get(prevCategory.code) : null
    const rootOrgId = (this.orgSelectedData && (this.orgSelectedData.identifier || this.orgSelectedData.id)) || ''
    const rootOrg: NSOrgHierarchy.IMoveOrg | null = rootOrgId
      ? { id: rootOrgId, name: this.orgSelectedData.orgName || this.orgSelectedData.channel || '', level: 0 }
      : null
    const currentParent: NSOrgHierarchy.IMoveOrg | null = parentTerm
      ? { id: this.getOrgIdOfTerm(parentTerm), name: parentTerm.name, level: parentTerm.level || (level - 1) }
      : rootOrg

    const dialogData: NSOrgHierarchy.IMoveDialogData = {
      organisation: {
        id: orgId,
        name: term.name,
        level,
        childCount: typeof term.childCount === 'number' ? term.childCount : (term.children ? term.children.length : 0),
        userCount: term.userCount || 0,
      },
      currentParent,
      rootOrg,
      // the tree columns are the hierarchy levels (up to maxAllowedLevel)
      levels: Array.from(this.frameworkService.list.values())
        .filter(column => typeof column.level === 'number')
        .map(column => ({ level: column.level as number, name: column.name })),
    }

    const dialogRef = this.dialog.open<MoveTermComponent, NSOrgHierarchy.IMoveDialogData, NSOrgHierarchy.IMoveDialogResult>(
      MoveTermComponent, {
      data: dialogData,
      autoFocus: false,
      restoreFocus: true,
      disableClose: true,
      // right-side full-height panel, same as the org hierarchy add/update modal
      position: { right: '0' },
      height: '100vh',
      width: '50%',
      panelClass: 'right-side-modal',
      maxWidth: '100vw',
    })

    dialogRef.afterClosed().subscribe(res => {
      if (!res || !res.moved) {
        return
      }
      this.moveDialogResponse = res
      // reload the tree (hierarchy read) and select the previously selected cards again
      this.treeHierarchySvc.setLoaderState(true)
      this.refreshAfterHierarchyChange(true, '')
    })
  }

  editCategoryName(column: any, index: any) {
    this.runWithOrgEditContext(() => this.editCategoryNameWithContext(column, index))
  }

  private editCategoryNameWithContext(column: any, index: any) {
    const dialog = this.dialog.open(CategoryEditModuleComponent, {
      data: {
        columnInfo: this.getColumnForEdit(column),
        frameworkId: this.frameworkService.getFrameworkId(),
        colIndex: index
      },
      width: '800px',
      panelClass: 'category-edit-container',
      position: { top: '50px' }
    })
    dialog.afterClosed().subscribe((res: any) => {
      if (res) {
        const requestBody = {
          frameworkId: this.frameworkService.getFrameworkId(),
          categoryCode: res.column.columnData.code,
          categoryName: res.column.formData.categoryName,
          categoryDescription: res.column.formData.categotyDescription || ''
        }
        this.updateCategory(requestBody)
      }
    })
  }

  getSelectedTermsAssociation(categoryCode: string) {
    let tempData: any = []
    const completeData = _.cloneDeep(this.frameworkService.completeResponse)
    if (completeData && completeData.categories && completeData.categories.length > 0) {
      completeData.categories.forEach((category: any, catIndex: any) => {
        if (category.terms && category.terms.length > 0) {
          category.terms.forEach((term: any) => {
            if (term.code === categoryCode) {
              tempData.push({
                name: term.name,
                category: term.category,
                ids: [term.code],
                nextCategory: term.children ? term.children[0].category : '',
                assocIds: []
              })
              if (term.associations && term.associations.length > 0) {
                term.associations.forEach((assoc: any) => {
                  const getIndex = tempData.findIndex((item: any) => item.ids && item.ids.includes(term.code))
                  tempData[getIndex]['assocIds'].push(assoc.code)
                })
              }
            }
          })
        } if (catIndex > 0 && category.terms && category.terms.length > 0) {
          category.terms.forEach((term: any) => {
            tempData.forEach((item: any) => {
              if (item.nextCategory === term.category && item.assocIds.includes(term.code)) {
                const pushData: any = {
                  name: term.name,
                  category: term.category,
                  ids: [term.code],
                  nextCategory: term.children ? term.children[0].category : '',
                  assocIds: []
                }
                if (term.associations && term.associations.length > 0) {
                  term.associations.forEach((assoc: any) => {
                    pushData['assocIds'].push(assoc.code)
                  })
                }
                tempData.push(pushData)
              }
            })
          })
        }
      })
    }
    return tempData
  }

  async updateCategory(event: any) {
    const requestBody = {
      request: {
        category: {
          name: event.categoryName || '',
          description: event.categoryDescription || '',
        }
      }
    }
    const frameworkObj = {
      id: event.frameworkId,
      category: event.categoryCode
    }
    this.treeHierarchySvc.setLoaderState(true)
    const updateCatRes = await this.treeHierarchySvc.updateCategory(requestBody, frameworkObj).toPromise().catch((_err: any) => {
      this.treeHierarchySvc.setLoaderState(false)
      if (_err && _err.error && _err.error.params && _err.error.params.errMsg) {
        this._snackBar.open(`${_err.error.params.errMsg}`)
      }
    })
    if (updateCatRes && updateCatRes.params && updateCatRes.params.status.toLowerCase() === 'successful') {
      await this.publishFramework(frameworkObj)
    }
  }

  async updateParentAssociation(selectedParent: any, currentTerm: any) {
    const framworkData = _.cloneDeep(this.frameworkService.completeResponse)
    const parentCategoryData = framworkData.categories.find((cat: any) => cat.code === selectedParent.category)
    if (parentCategoryData && parentCategoryData.terms && parentCategoryData.terms.length > 0) {
      const currentParentTerm = parentCategoryData.terms.find((term: any) => {
        if (term.associations && term.associations.length > 0) {
          return term.associations.some((assoc: any) => assoc.code === currentTerm.code)
        }
      })
      if (currentParentTerm) {
        const updateOldParentAssociation: any = {
          request: {
            term: {
              associations: []
            }
          }
        }
        currentParentTerm.associations.forEach((assoc: any) => {
          if (assoc.code !== currentTerm.code) {
            updateOldParentAssociation.request.term.associations.push({ identifier: assoc.identifier })
          }
        })
        await this.updateHierarchyAssocication(updateOldParentAssociation, framworkData.identifier, currentParentTerm)
      }
      selectedParent = parentCategoryData.terms.find((term: any) => term.code === selectedParent.code)
      const updateNewParentAssociation: any = {
        request: {
          term: {
            associations: []
          }
        }
      }
      if (selectedParent && selectedParent.associations && selectedParent.associations.length > 0) {
        selectedParent.associations.forEach((assoc: any) => {
          updateNewParentAssociation.request.term.associations.push({ identifier: assoc.identifier })
        })
      }
      updateNewParentAssociation.request.term.associations.push({ identifier: currentTerm.identifier })
      await this.updateHierarchyAssocication(updateNewParentAssociation, framworkData.identifier, selectedParent)
    }
  }

  async updateHierarchyAssocication(requestBody: any, frameworkId: any, termData: any) {
    this.treeHierarchySvc.setLoaderState(true)
    await this.treeHierarchySvc.updateFrameworkAssociation(requestBody, { id: frameworkId, category: termData.category }, termData.code).toPromise().catch((err: any) => {
      console.error('Error in updating association', err)
      this.treeHierarchySvc.setLoaderState(false)
      this._snackBar.open(`Error in updating association`, 'cancel')
    })
  }

  checkChildOrg() {
    return (this.childOrgData?.rootOrgId !== this.orgSelectedData?.id || this.userRolesData?.has('mdo_admin')) ? true : false
  }
}