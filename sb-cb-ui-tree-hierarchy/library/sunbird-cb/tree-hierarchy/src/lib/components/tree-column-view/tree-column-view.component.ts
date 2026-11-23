import { AfterViewInit, Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output } from '@angular/core';
import { FrameworkService } from '../../services/framework.service';
import { Subscription, fromEvent } from 'rxjs';
import { ConnectorService } from '../../services/connector.service';
import { ApprovalService } from '../../services/approval.service';
import { CardChecked, CardSelection, CardsCount, Card } from '../../models/variable-type.model';
import { NSOrgHierarchy } from '../../models/org-hierarchy.model';
import * as _ from 'lodash'
import { UntypedFormControl, Validators } from '@angular/forms';
import { auditTime, debounceTime, distinctUntilChanged, filter } from 'rxjs/operators';

/** Distance from the bottom of a column (px) at which the next page is requested */
const SCROLL_LOAD_THRESHOLD_PX = 80;

declare var LeaderLine: any;
@Component({
    selector: 'lib-tree-column-view',
    templateUrl: './tree-column-view.component.html',
    styleUrls: ['./tree-column-view.component.scss'],
    standalone: false
})
export class TreeColumnViewComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit {
  @Input() column: any;
  @Input() containerId: string | undefined
  @Input() isChildOrg = false
  @Input() childOrg: any
  connectorMapping: any = {}
  @Output() updateTaxonomyTerm = new EventEmitter<CardSelection>(true);
  @Output() updateTermList = new EventEmitter<CardChecked>();
  @Output() cardsCount = new EventEmitter<CardsCount>();
  @Output() cardAction = new EventEmitter<CardSelection>();
  columnData: Array<Card> = [];
  childSubscription: Subscription | undefined;
  newTermSubscription: Subscription | undefined;
  approvalTerm: any;
  termshafall: Array<Card> = [];
  searchValue = new UntypedFormControl('', [Validators.required]);
  startIndex = 0
  limitToAdd = 50
  currentLastIndex = 50
  columnItems: any = []
  filteredColumnItems: any = []
  private searchSubscription: Subscription | undefined;
  private approvalSubscription: Subscription | undefined;
  private hierarchySubscription: Subscription | undefined;
  private scrollSubscription: Subscription | undefined;
  constructor(
    private frameworkService: FrameworkService,
    private connectorService: ConnectorService,
    private approvalService : ApprovalService,
    private ngZone: NgZone
  ) {
  }
  ngOnChanges(): void {}

  /** Org hierarchy columns are fed page by page from the v2 hierarchy API */
  get isOrgHierarchy(): boolean {
    return this.frameworkService.isOrgHierarchyMode
  }

  /** Records, search and paging of this column come from the server */
  get isServerPaged(): boolean {
    return !!this.column && this.frameworkService.isServerPagedColumn(this.column.code)
  }

  private get hierarchyState(): NSOrgHierarchy.IColumnState | null {
    return this.column ? this.frameworkService.getHierarchyColumnState(this.column.code) : null
  }

  ngOnInit(): void {
    this.subscribeEvents()
    if (this.isOrgHierarchy) {
      const state = this.hierarchyState
      if (state && state.query) {
        this.searchValue.setValue(state.query, { emitEvent: false })
      }
      this.hierarchySubscription = this.frameworkService.hierarchyColumnEvents$(this.column.code)
        .subscribe(event => this.onHierarchyColumnEvent(event))
    }
    this.setColumnItems()
    this.searchSubscription = this.searchValue.valueChanges.pipe(
      debounceTime(700),
      distinctUntilChanged(),
    ).subscribe((ele: any) => {
      this.searchFilterData(ele)
    })
    if (this.column.index === 1 && !this.isOrgHierarchy) {
      this.approvalSubscription = this.approvalService.getUpdateList().subscribe((list:any) => {
        this.approvalTerm = list.filter((item: any) => this.column.code === item.category)
        if(this.approvalTerm){
          this.approvalTerm.forEach((term: any, _i: number)=> {
             this.column.children.forEach((lel: any, _j: number) => {
                if(lel.identifier === term.identifier){
                  if(!this.isExists(term)){
                    this.termshafall.push(lel)
                  }
                }
             })
          })
          // this.termshafall = [...this.termshafall]
          this.column.children.forEach((tr: any, _i: number) => {
            if(!this.isExists(tr)){
              this.termshafall.push(tr)
            }
          })
          this.columnData = this.transform(this.termshafall);
          this.setColumnItems()
          if(this.columnData && this.columnData.length) {
            this.cardsCount.emit({category: this.columnData[0].category || this.column.code,count:this.columnData.length});
          }
        }
      })
    }
    this.connectorMapping = this.connectorService.connectorMap
    // this.frameworkService.isDataUpdated.subscribe(() => {
    //   this.ngOnInit()
    // })

  }

  ngAfterViewInit(): void {
    this.listenForScrollEnd()
  }

  /** Requests the next page when the column container is scrolled to its last record */
  private listenForScrollEnd() {
    if (!this.isOrgHierarchy || !this.containerId) {
      return
    }
    const container = document.getElementById(this.containerId)
    if (!container) {
      return
    }
    this.ngZone.runOutsideAngular(() => {
      this.scrollSubscription = fromEvent(container, 'scroll', { passive: true }).pipe(
        auditTime(200),
        filter(() => container.scrollTop + container.clientHeight >= container.scrollHeight - SCROLL_LOAD_THRESHOLD_PX),
        filter(() => {
          const state = this.hierarchyState
          return this.isServerPaged && !!state && state.hasMore && !state.isLoading
        })
      ).subscribe(() => this.ngZone.run(() => this.loadMore()))
    })
  }

  /** Applies a hierarchy state change of this column (page loaded/appended, search results, counts, reset) */
  private onHierarchyColumnEvent(event: NSOrgHierarchy.IColumnEvent | null) {
    if (!event) {
      return
    }
    this.columnData = event.state ? event.state.records : []
    this.setColumnItems()
    switch (event.reason) {
      case 'load':
      case 'append':
        this.emitCardsCount()
        this.redrawParentConnectors()
        break
      case 'search':
        this.emitCardsCount()
        this.refreshSelectionAfterSearch()
        break
      default:
        break
    }
  }

  private emitCardsCount() {
    if (this.columnData.length > 0) {
      this.cardsCount.emit({ category: this.columnData[0].category || '', count: this.columnData.length })
    } else {
      this.cardsCount.emit({ category: this.column.code, count: 0 })
    }
  }

  /** Connects the selected parent card to the loaded cards (only while no card of this column is selected) */
  private redrawParentConnectors() {
    if (this.column.index <= 1 || this.frameworkService.selectionList.has(this.column.code)) {
      return
    }
    const back = this.frameworkService.getPreviousCategory(this.column.code)
    const parent = back ? this.frameworkService.selectionList.get(back.code) : null
    if (!back || !parent || !parent.cardRef) {
      return
    }
    setTimeout(() => {
      if (this.frameworkService.selectionList.get(back.code) === parent && !this.frameworkService.selectionList.has(this.column.code)) {
        this.setConnectors(parent.cardRef, this.columnItems, 'ALL')
      }
    }, 100)
  }
 
  isExists(e:any){
    let temp;
    if(this.termshafall && this.termshafall.length) {
      temp = this.termshafall.map(t => t.identifier)
      return temp.includes(e.identifier)
    } return false
  }
  
  subscribeEvents() {
    if (this.childSubscription) {
      this.childSubscription.unsubscribe()
    }
    this.childSubscription = this.frameworkService.currentSelection.subscribe(e => {
      if (!e) {
        return
      } else if (e.type === this.column.code) {
        const selectedTerm = {...e.data, cardRef: e.cardRef }
        if(e.isUpdate){
          this.updateTaxonomyTerm.emit({ isSelected: true, selectedTerm, isUpdate: true })
        } else {
          this.updateTaxonomyTerm.emit({ isSelected: true, selectedTerm })
        }
        this.columnData = this.transform((this.columnData || []).map(item => {
          if (item.code === e.data.code) {
            item.selected = true
          } else {
            item.selected = false
          }
          return item
        }));
        this.setColumnItems()
        this.setConnectors(e.cardRef, this.columnItems, 'SINGLE')
        return
      } else {
        const next = this.frameworkService.getNextCategory(e.type);
        if (next && next.code === this.column.code) {
          
          setTimeout(() => {
            this.setConnectors(e.cardRef, next && next.index < this.column.index ? [] : this.columnItems, 'ALL')
          }, 100);
        }

        if (next && next.index < this.column.index) {
          this.columnData = [];
          this.setColumnItems()
        }
      }
    })
    if (this.newTermSubscription) {
      this.newTermSubscription.unsubscribe()
    }
    this.newTermSubscription = this.frameworkService.insertUpdateDeleteNotifier.subscribe(e => {
      if (e && e.action) {
        const next = this.frameworkService.getNextCategory(e.action);
        if(next) {
          if (this.column.code === next.code && e.type === 'select') {
            this.insertUpdateHandler(e, next)
          } 
          if(e.type === 'update') {
            if(this.column.code === next.code && e.type === 'update') {
              // this.column = this.frameworkService.list.get(e.action)
              
              
              const selectedParent: any = this.frameworkService.getPreviousCategory(e.action);
              const selectedParentData = this.frameworkService.list.get(selectedParent.code)
              const selectedParentCardRef = this.frameworkService.selectionList.get(selectedParent.code) && 
              this.frameworkService.selectionList.get(selectedParent.code).cardRef
              
              if(selectedParent && selectedParentData && selectedParentData.children && selectedParentData.children.length > 0) {
                
                // this.insertUpdateHandler(e, next, 'update')
                // this.column = this.frameworkService.list.get(e.action)
                // this.column = this.frameworkService.list.get()
                this.frameworkService.currentSelection.next({ type: selectedParent.code, data:selectedParentData.children[0], cardRef:selectedParentCardRef, isUpdate: true})
              }
            }
          }
        }
      }
    })
  }
  insertUpdateHandler(e: any, _next: any, isUpdate?: any) {
    if (this.isOrgHierarchy) {
      // Parent selected: the service is (re)loading its children; show what is loaded and clear selection
      const state = this.hierarchyState
      this.columnData = state ? state.records : []
      this.columnData.forEach((item: any) => { item.selected = false })
      this.setColumnItems()
      this.emitCardsCount()
      return
    }
    const back = this.frameworkService.getPreviousCategory(this.column.code)
    
    const localTerms:any = []
    this.frameworkService.getLocalTermsByCategory(this.column.code).forEach(f => {
      const selectedParent = back ? this.frameworkService.selectionList.get(back.code) : null; //can use current
      
      if (selectedParent && ((f.parent.code === selectedParent.code) || (f.parent.identifier && (f.parent.identifier === selectedParent.identifier)))) {
        localTerms.push(f.term)
      }
    })
    if(!isUpdate) {
    // get last parent and filter Above
    if(e && e.data) {
    this.columnData = this.transform([...localTerms, ...(e.data.children || [])])
      .filter((x:any) => {
        return x.category == this.column.code
      }).map((mer:any) => {
        //**read local children for next */
        // const nextChildren = this.frameworkService.getLocalTermsByParent(this.column.code)
        
        /**reset Next level children */
        this.column.children = this.column.children.map((col:any) => { col.selected = false; return col })
        mer.selected = false
        mer.children = ([...this.column.children.filter((x:any) => { return x.code === mer.code }).map((a: any) => a.children)].shift() || [])
        return mer
      });
    }
      this.setColumnItems()

    if(this.columnData.length > 0) {
      this.cardsCount.emit({category: this.columnData[0].category || '',count:this.columnData.length});
    } else {
      this.cardsCount.emit({category: this.column.code,count: 0});
    }
    // this.updateTerms()

    }
  }
  updateSelection1(_data: any) {
  }

  setColumnItems() {
    // const selected = this.column.children.filter(f => { return f.selected })
    // if (selected.length > 0) {
    //   const data = this.columnData.map(cd => {
    //     cd.selected = this.column.children.filter(f => { return cd.identifier === f.identifier }).map(s => s.selected)[0]
    //     return cd
    //   })
    //   return data
    // } else {
    if (this.isServerPaged) {
      // already filtered and paged by the server
      this.filteredColumnItems = this.columnData || []
      this.columnItems = [...this.filteredColumnItems]
      return
    }
    let localSearchValue = this.searchValue.value && this.searchValue.value.toLowerCase() || ''
    let filteredColumnData = []
    this.columnItems = []
    if(localSearchValue) {
      filteredColumnData = this.columnData.filter((child: any) => {
        if(child.name.toLowerCase().includes(localSearchValue) || 
        (_.get(child, 'refId') && _.get(child, 'refId').toLowerCase().includes(localSearchValue)) || 
        (_.get(child, 'description') && _.get(child, 'description').toLowerCase().includes(localSearchValue))||
        (_.get(child, 'additionalProperties.displayName') && _.get(child, 'additionalProperties.displayName').toLowerCase().includes(localSearchValue))) {
          return child
        }
      })
    } else {
      filteredColumnData = this.columnData
    }
    this.filteredColumnItems = filteredColumnData
    this.columnItems = filteredColumnData ? filteredColumnData.slice(this.startIndex, this.currentLastIndex) : []
    // }
  }

  transform(value: any, sortBy = 'timeStamp'): any{
    if(!sortBy) {
      if(value) {
        return value.slice().reverse();
      } else {
        return null
      }
    } else {
      if(Array.isArray(value)) {
          return  value.sort((a, b) => {
            const timestampA = a.additionalProperties && a.additionalProperties.timeStamp ? new Date(Number(a.additionalProperties.timeStamp)).getTime() : 0;
            const timestampB = b.additionalProperties && b.additionalProperties.timeStamp ? new Date(Number(b.additionalProperties.timeStamp)).getTime() : 0;
             
            return  timestampB - timestampA;
            
            });
     
      }
    }
     
  }

  searchFilterData(_ele: any){
    if (this.isServerPaged) {
      // server-side search (offset 0, results replace the column); selection is refreshed when results arrive
      if (!this.frameworkService.searchHierarchyColumn(this.column.code, _ele || '')) {
        this.setColumnItems()
      }
      return
    }
    this.setColumnItems()
    this.refreshSelectionAfterSearch()
  }

  /** Re-selects the parent card so connectors and downstream columns match the new column content */
  private refreshSelectionAfterSearch() {
    const back = this.frameworkService.getPreviousCategory(this.column.code)
    if(back && back.code) {
      let backColumData = this.frameworkService.selectionList.get(back.code)
      if(backColumData && backColumData.category) {
        this.frameworkService.removeOldLine()
      
        setTimeout(() => {
          this.frameworkService.currentSelection.next({ type: backColumData.category, data: backColumData, cardRef: backColumData.cardRef })
        }, 200)
      }
    } else {
      if(this.columnItems?.length === 0) {
        this.frameworkService.removeOldLine()
      } else {
        setTimeout(() => {
          this.makeFirstTermSelected()
        },500)
      }
    }
   }

  clearSearch() {
    this.searchValue.setValue('')
  }

  loadMore() {
    if (this.isServerPaged) {
      this.frameworkService.loadNextHierarchyPage(this.column.code)
      return
    }
    this.currentLastIndex = this.currentLastIndex + this.limitToAdd
    this.searchFilterData(this.searchValue.value)
  }

  setConnectors(elementClicked: any, columnItem: any, mode: any) {
    this.removeConnectors(elementClicked, 'box' + (this.column.index - 1), this.column.index - 1)
    
    if (mode === 'ALL') {
      // let tempconnectorMapping = {}
      // this.connectorService.updateConnectorsMap(tempconnectorMapping)
      // {
      //   ['column' + (this.column.index- 1)]: ''

      // }
      const ids = columnItem.map((_c: any, i: any) => {
        return this.column.code + 'Card' + (i + 1)
      })
      this.connectorMapping['box' + (this.column.index - 1)] = { source: elementClicked, lines: (ids || []).map((id: any) => { return { target: id, line: '', targetType: 'id' } }) }
      this.connectorService.updateConnectorsMap(this.connectorMapping)
      
      const connectionLines = this.connectorService._drawLine(
        this.connectorMapping['box' + (this.column.index - 1)].source,
        this.connectorMapping['box' + (this.column.index - 1)].lines,
        null,
        '#box' + (this.column.index - 1),
        '#box' + this.column.index
      )
      this.connectorMapping['box' + (this.column.index - 1)].lines = connectionLines
    } else {
      if (this.column.index > 1 && this.connectorMapping['box' + (this.column.index - 1)]) {
        this.connectorMapping['box' + (this.column.index - 1)].lines = [{ target: elementClicked, line: '', targetType: 'element' }]

        this.connectorService.updateConnectorsMap(this.connectorMapping)
        const connectionLines = this.connectorService._drawLine(
          this.connectorMapping['box' + (this.column.index - 1)].source,
          this.connectorMapping['box' + (this.column.index - 1)].lines,
          null,
          '#box' + (this.column.index - 1),
          '#box' + this.column.index
        )
        this.connectorMapping['box' + (this.column.index - 1)].lines = connectionLines
      }

    }
    this.connectorService.updateConnectorsMap(this.connectorMapping)

  }
  removeConnectors(currentElement: any, prevCol: any, currentIndex: any) {
    if (this.connectorMapping) {
      for (const key in this.connectorMapping) {
        // Remove all n-1 lines and keep only current selection, also clear n+1 lines
        if (this.connectorMapping[key] && this.connectorMapping[key].lines && this.connectorMapping[key].lines.length > 0) {
          const lines = this.connectorMapping[key].lines
          lines.forEach(async (element: any, index: any) => {
            if (element != currentElement && prevCol == key) {
              await element.line && element.line.remove();
              lines.splice(index, 1);
            }
          });
          this.connectorMapping[key].lines = lines
        }

        // remove all n+2 lines, if clicks previous columns and tree was already drilled down
        let count = currentIndex + 2;
        let nextCol = `box${count}`
        if (this.connectorMapping[nextCol] && this.connectorMapping[nextCol].lines && this.connectorMapping[nextCol].lines.length > 0) {
          const lines = this.connectorMapping[nextCol].lines
          lines.forEach(async (element: any, index: any) => {
            await element.line && element.line.remove();
            lines.splice(index, 1);
          })
          this.connectorMapping[nextCol].lines = null
        }
      }

    }
  }
  selectedCard(event: any){
    this.updateTermList.emit(event);
  }

  get showLoadMoreButton(): boolean {
    if (this.isServerPaged) {
      const state = this.hierarchyState
      return !!(state && state.hasMore)
    }
    return !this.disableLoadButton
  }

  get disableLoadButton(): boolean {
    if (this.isServerPaged) {
      const state = this.hierarchyState
      return !state || !state.hasMore || state.isLoading
    }
    if(this.filteredColumnItems && this.filteredColumnItems.length < this.currentLastIndex) {
      return true
    }
    return false
  }

  ngOnDestroy(): void {
    if (this.childSubscription) {
      this.childSubscription.unsubscribe()
    }
    if(this.newTermSubscription) {
      this.newTermSubscription.unsubscribe()
    }
    [this.searchSubscription, this.approvalSubscription, this.hierarchySubscription, this.scrollSubscription]
      .forEach(sub => sub && sub.unsubscribe())
  }

  cardActionEmit(event: any) {
    this.cardAction.emit(event);
  }

  makeFirstTermSelected() {
    const firstListItem = this.frameworkService.list.entries().next().value as any
    if(firstListItem && firstListItem.length >= 2){
      if(firstListItem[1] && firstListItem[1].children && firstListItem[1].children.length) {
        const firstTerm = firstListItem[1].children[0] as any
        const cardRef = document.getElementById(firstTerm.name)
        // this.categoryList = []
        firstTerm.selected = true
        this.frameworkService.cardClkData = firstTerm;
        this.frameworkService.CurrentCardClk.next(firstTerm.category)
        this.frameworkService.currentSelection.next({ type: firstTerm.category, data: firstTerm, cardRef })
      }
    }
  }
  
}