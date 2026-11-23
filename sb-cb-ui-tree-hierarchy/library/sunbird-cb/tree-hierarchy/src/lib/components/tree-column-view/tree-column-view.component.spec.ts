import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ReactiveFormsModule } from '@angular/forms';

import { ConnectorService } from '../../services/connector.service';
import { FrameworkService } from '../../services/framework.service';
import { TreeColumnViewComponent } from './tree-column-view.component';

describe('TreeColumnViewComponent', () => {
  let component: TreeColumnViewComponent;
  let fixture: ComponentFixture<TreeColumnViewComponent>;
  let frameworkService: FrameworkService;
  let cardsCountEvents: any[];

  function buildColumn() {
    return {
      code: 'board',
      index: 1,
      name: 'Board',
      config: { showSearch: true },
      children: [
        { identifier: 'a', code: 'a', name: 'Alpha', category: 'board', additionalProperties: { timeStamp: '1000' } },
        { identifier: 'b', code: 'b', name: 'Beta', category: 'board', description: 'second', additionalProperties: { timeStamp: '3000' } },
        { identifier: 'c', code: 'c', name: 'Gamma', category: 'board', additionalProperties: { timeStamp: '2000' } },
      ],
    };
  }

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ TreeColumnViewComponent ],
      imports: [ ReactiveFormsModule ],
      // ConnectorService is not providedIn root; TreeHierarchyModule provides it
      providers: [ provideHttpClient(), provideHttpClientTesting(), ConnectorService ],
      // lib-term-card and mat-icon are rendered as children; they are covered by their own specs
      schemas: [ NO_ERRORS_SCHEMA ],
    })
    .compileComponents();
  }));

  beforeEach(() => {
    frameworkService = TestBed.inject(FrameworkService);
    fixture = TestBed.createComponent(TreeColumnViewComponent);
    component = fixture.componentInstance;
    component.column = buildColumn();
    cardsCountEvents = [];
    component.cardsCount.subscribe(e => cardsCountEvents.push(e));
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should build first column data sorted by newest timestamp and emit the count', () => {
    expect(component.columnData.map(c => c.identifier)).toEqual(['b', 'c', 'a']);
    expect(component.columnItems.length).toBe(3);
    expect(cardsCountEvents).toEqual([{ category: 'board', count: 3 }]);
  });

  it('should render one card per column item', () => {
    expect(fixture.nativeElement.querySelectorAll('lib-term-card').length).toBe(3);
    expect(fixture.nativeElement.querySelector('#boardCard1')).toBeTruthy();
  });

  it('should filter column items by the search value', () => {
    component.searchValue.setValue('second');
    component.setColumnItems();
    expect(component.columnItems.map((c: any) => c.identifier)).toEqual(['b']);
    component.searchValue.setValue('');
    component.setColumnItems();
    expect(component.columnItems.length).toBe(3);
  });

  it('should disable load more when all filtered items are shown', () => {
    expect(component.disableLoadButton).toBe(true);
    component.currentLastIndex = 2;
    expect(component.disableLoadButton).toBe(false);
  });

  it('should show the load more button only while more client-side items remain', () => {
    expect(component.showLoadMoreButton).toBe(false);
    component.currentLastIndex = 2;
    expect(component.showLoadMoreButton).toBe(true);
  });

  it('should emit updateTaxonomyTerm and mark the selected item when its column is selected', () => {
    spyOn(component.updateTaxonomyTerm, 'emit');
    const cardRef = document.createElement('div');
    frameworkService.currentSelection.next({ type: 'board', data: { code: 'c', name: 'Gamma' }, cardRef });

    expect(component.updateTaxonomyTerm.emit).toHaveBeenCalledWith({
      isSelected: true, selectedTerm: { code: 'c', name: 'Gamma', cardRef },
    } as any);
    expect(component.columnData.filter(c => c.selected).map(c => c.code)).toEqual(['c']);
  });

  it('should pass isUpdate through when the selection is an update', () => {
    spyOn(component.updateTaxonomyTerm, 'emit');
    frameworkService.currentSelection.next({ type: 'board', data: { code: 'a' }, cardRef: null, isUpdate: true });
    expect(component.updateTaxonomyTerm.emit).toHaveBeenCalledWith(jasmine.objectContaining({ isSelected: true, isUpdate: true }));
  });

  it('should re-emit selected card events as updateTermList', () => {
    spyOn(component.updateTermList, 'emit');
    const event = { term: { identifier: 'a' }, checked: true };
    component.selectedCard(event);
    expect(component.updateTermList.emit).toHaveBeenCalledWith(event as any);
  });

  it('should re-emit card actions', () => {
    spyOn(component.cardAction, 'emit');
    const event = { action: 'manage-org', data: {} };
    component.cardActionEmit(event);
    expect(component.cardAction.emit).toHaveBeenCalledWith(event as any);
  });

  it('should detect existing terms by identifier', () => {
    expect(component.isExists({ identifier: 'a' })).toBe(true);
    expect(component.isExists({ identifier: 'z' })).toBe(false);
  });

  it('should unsubscribe from framework events on destroy', () => {
    fixture.destroy();
    expect(component.childSubscription!.closed).toBe(true);
    expect(component.newTermSubscription!.closed).toBe(true);
  });
});

describe('TreeColumnViewComponent (org hierarchy v2)', () => {
  let component: TreeColumnViewComponent;
  let fixture: ComponentFixture<TreeColumnViewComponent>;
  let frameworkService: FrameworkService;
  let cardsCountEvents: any[];
  let states: { [code: string]: any };
  let events: BehaviorSubject<any>;

  const record = (id: string) => ({ identifier: id, code: id, name: `Org ${id}`, category: 'level3', childCount: 1, userCount: 0, additionalProperties: { orgId: id } });

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ TreeColumnViewComponent ],
      imports: [ ReactiveFormsModule ],
      providers: [ provideHttpClient(), provideHttpClientTesting(), ConnectorService ],
      schemas: [ NO_ERRORS_SCHEMA ],
    })
    .compileComponents();
  }));

  beforeEach(() => {
    frameworkService = TestBed.inject(FrameworkService);
    frameworkService.isOrgHierarchyMode = true;
    frameworkService.categoriesHash.next([{ code: 'level2', index: 1 }, { code: 'level3', index: 2 }] as any);
    states = { level3: { parentId: 'p', records: [record('a'), record('b')], hasMore: true, isLoading: false, query: '' } };
    events = new BehaviorSubject<any>({ state: states['level3'], reason: 'load' });
    spyOn(frameworkService, 'getHierarchyColumnState').and.callFake((code: string) => states[code] || null);
    spyOn(frameworkService, 'hierarchyColumnEvents$').and.returnValue(events.asObservable());
    fixture = TestBed.createComponent(TreeColumnViewComponent);
    component = fixture.componentInstance;
    component.column = { code: 'level3', index: 2, name: 'Directorate', config: { showSearch: true }, children: states['level3'].records };
    cardsCountEvents = [];
    component.cardsCount.subscribe(e => cardsCountEvents.push(e));
    fixture.detectChanges();
  });

  afterEach(() => {
    frameworkService.isOrgHierarchyMode = false;
    frameworkService.selectionList.clear();
  });

  it('should render the loaded page in server order without client-side slicing', () => {
    expect(component.columnItems.map((c: any) => c.identifier)).toEqual(['a', 'b']);
    expect(cardsCountEvents[cardsCountEvents.length - 1]).toEqual({ category: 'level3', count: 2 });
  });

  it('should show appended records', () => {
    const appended = { ...states['level3'], records: [record('a'), record('b'), record('c')], hasMore: false };
    states['level3'] = appended;
    events.next({ state: appended, reason: 'append' });
    expect(component.columnItems.length).toBe(3);
    expect(component.showLoadMoreButton).toBeFalse();
  });

  it('should send the search to the server instead of filtering locally', fakeAsync(() => {
    const searchSpy = spyOn(frameworkService, 'searchHierarchyColumn').and.returnValue(true);
    component.searchValue.setValue('Dep');
    tick(700);
    expect(searchSpy).toHaveBeenCalledWith('level3', 'Dep');
    expect(component.columnItems.length).toBe(2); // unchanged until results arrive
  }));

  it('should show search results and re-select the parent card to redraw connectors', fakeAsync(() => {
    const parent = { identifier: 'p', category: 'level2', cardRef: document.createElement('div') };
    frameworkService.selectionList.set('level2', parent);
    const nextSpy = spyOn(frameworkService.currentSelection, 'next');
    const results = { ...states['level3'], records: [record('x')], query: 'x' };
    events.next({ state: results, reason: 'search' });
    expect(component.columnItems.map((c: any) => c.identifier)).toEqual(['x']);
    tick(200);
    expect(nextSpy).toHaveBeenCalledWith({ type: 'level2', data: parent, cardRef: parent.cardRef });
  }));

  it('should request the next page from the load more button', () => {
    const nextPageSpy = spyOn(frameworkService, 'loadNextHierarchyPage').and.returnValue(true);
    expect(component.showLoadMoreButton).toBeTrue();
    component.loadMore();
    expect(nextPageSpy).toHaveBeenCalledWith('level3');
  });

  it('should disable load more while a page is loading', () => {
    states['level3'] = { ...states['level3'], isLoading: true };
    expect(component.disableLoadButton).toBeTrue();
  });

  it('should take the loaded records and clear the selection when a parent is selected', () => {
    states['level3'].records[0].selected = true;
    component.insertUpdateHandler({ data: { identifier: 'p' } }, null);
    expect(component.columnData.every((c: any) => !c.selected)).toBeTrue();
    expect(component.columnItems.length).toBe(2);
  });

  it('should load the next page when the column is scrolled to the bottom', fakeAsync(() => {
    fixture.destroy();
    const container = document.createElement('div');
    container.id = 'boxScrollTest';
    let scrollTop = 0;
    Object.defineProperty(container, 'scrollHeight', { value: 1000 });
    Object.defineProperty(container, 'clientHeight', { value: 400 });
    Object.defineProperty(container, 'scrollTop', { get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
    document.body.appendChild(container);
    const fixture2 = TestBed.createComponent(TreeColumnViewComponent);
    const comp2 = fixture2.componentInstance;
    comp2.column = component.column;
    comp2.containerId = 'boxScrollTest';
    fixture2.detectChanges();
    const nextPageSpy = spyOn(frameworkService, 'loadNextHierarchyPage').and.returnValue(true);

    container.scrollTop = 100;
    container.dispatchEvent(new Event('scroll'));
    tick(250);
    expect(nextPageSpy).not.toHaveBeenCalled();

    container.scrollTop = 560;
    container.dispatchEvent(new Event('scroll'));
    tick(250);
    expect(nextPageSpy).toHaveBeenCalledWith('level3');

    fixture2.destroy();
    container.remove();
  }));
});
