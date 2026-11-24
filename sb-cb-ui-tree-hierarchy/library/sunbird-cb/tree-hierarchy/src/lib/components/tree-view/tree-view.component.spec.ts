import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { ApprovalService } from '../../services/approval.service';
import { ConnectorService } from '../../services/connector.service';
import { FrameworkService } from '../../services/framework.service';
import { TreeHierarchyService } from '../../tree-hierarchy.service';
import { TreeViewComponent } from './tree-view.component';

describe('TreeViewComponent', () => {
  let component: TreeViewComponent;
  let fixture: ComponentFixture<TreeViewComponent>;
  let frameworkService: FrameworkService;
  let approvalService: ApprovalService;
  let loadOrgHierarchySpy: jasmine.Spy;

  const boardColumn: any = {
    code: 'board', index: 1, name: 'Board', config: {},
    children: [
      { identifier: 'b1', code: 'b1', name: 'B1', category: 'board' },
      { identifier: 'b2', code: 'b2', name: 'B2', category: 'board', status: 'Retired' },
    ],
  };
  const mediumColumn: any = {
    code: 'medium', index: 2, name: 'Medium', config: {},
    children: [],
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ TreeViewComponent ],
      imports: [ MatDialogModule, MatSnackBarModule ],
      // ConnectorService is not providedIn root; TreeHierarchyModule provides it
      providers: [ provideHttpClient(), provideHttpClientTesting(), ConnectorService ],
      // child components (lib-tree-column-view, lib-action-bar, mat-icon) are covered by their own specs
      schemas: [ NO_ERRORS_SCHEMA ],
    })
    .compileComponents();
  }));

  beforeEach(() => {
    frameworkService = TestBed.inject(FrameworkService);
    approvalService = TestBed.inject(ApprovalService);
    loadOrgHierarchySpy = spyOn(frameworkService, 'loadOrgHierarchy').and.returnValue(of({} as any));
    fixture = TestBed.createComponent(TreeViewComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    frameworkService.list.clear();
    frameworkService.selectionList.clear();
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should not call the hierarchy API and report no framework when no org is selected', () => {
    const emitted: boolean[] = [];
    component.frameWorkCreated.subscribe(v => emitted.push(v));
    fixture.detectChanges();
    expect(loadOrgHierarchySpy).not.toHaveBeenCalled();
    expect(emitted).toEqual([false]);
    expect(component.isLoading).toBe(false);
    expect(component.isFraworkLoading).toBe(false);
  });

  it('should pass the selected org data when loading the hierarchy', () => {
    component.orgSelectedData = { id: 'org1' };
    component.childOrgData = { rootOrgId: 'org1' };
    fixture.detectChanges();
    expect(loadOrgHierarchySpy).toHaveBeenCalledWith({ id: 'org1' }, { rootOrgId: 'org1' });
  });

  it('should push the environment and taxonomy config to the framework service', () => {
    component.environment = { frameworkName: 'fw' };
    component.taxonomyConfig = [{ frameworkId: 'fw', config: [] }];
    fixture.detectChanges();
    expect(frameworkService.getEnviroment()).toEqual({ frameworkName: 'fw' });
    expect(frameworkService.rootConfig).toEqual(component.taxonomyConfig);
  });

  it('should show the action bar only for the approval view', () => {
    component.isApprovalView = true;
    fixture.detectChanges();
    expect(component.showActionBar).toBe(true);
  });

  it('should emit loader state changes', () => {
    const emitted: any[] = [];
    component.loaderEnable.subscribe(v => emitted.push(v));
    fixture.detectChanges();
    TestBed.inject(TreeHierarchyService).setLoaderState(true);
    expect(emitted).toEqual([false, true]);
  });

  it('should render a column per framework category', () => {
    frameworkService.list.set('board', boardColumn);
    frameworkService.list.set('medium', mediumColumn);
    fixture.detectChanges();
    expect(component.list.length).toBe(2);
    expect(fixture.nativeElement.querySelector('#box1Container')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#box2Container')).toBeTruthy();
  });

  describe('after init', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should track draft terms and toggle the action bar', () => {
      const term: any = { identifier: 't1' };
      component.updateDraftStatusTerms({ checked: true, term });
      expect(component.draftTerms).toEqual([term]);
      expect(component.showActionBar).toBe(true);
      component.updateDraftStatusTerms({ checked: false, term });
      expect(component.draftTerms).toEqual([]);
      expect(component.showActionBar).toBe(false);
    });

    it('should hide the action bar on close', () => {
      component.showActionBar = true;
      component.closeActionBar(null);
      expect(component.showActionBar).toBe(false);
    });

    it('should record card counts per category', () => {
      component.getNoOfCards({ category: 'board', count: 2 });
      component.getNoOfCards({ category: 'medium', count: 1 });
      expect(component.categoryList).toEqual([{ category: 'board', count: 2 }, { category: 'medium', count: 1 }]);
    });

    it('should count non retired terms for the first column', () => {
      frameworkService.list.set('board', boardColumn);
      expect(component.getCount('board')).toBe(1);
    });

    it('should return 0 for a column whose parent has no selection', () => {
      frameworkService.list.set('board', boardColumn);
      frameworkService.list.set('medium', mediumColumn);
      expect(component.getCount('medium')).toBe(0);
    });

    it('should mark only the selected term in a category', () => {
      const column: any = { code: 'board', children: [{ code: 'b1' }, { code: 'b2' }] };
      frameworkService.list.set('board', column);
      component.updateSelection('board', 'b2');
      expect(column.children.map((c: any) => c.selected)).toEqual([false, true]);
    });

    it('should report whether a column has a selection', () => {
      expect(component.isEnabled('board')).toBe(false);
      frameworkService.selectionList.set('board', { code: 'b1' });
      expect(component.isEnabled('board')).toBe(true);
    });

    it('should enable only the first column when nothing is selected', () => {
      frameworkService.currentSelection.next(null);
      expect(component.isCurrentOrNextTerm({}, 0)).toBe(true);
      expect(component.isCurrentOrNextTerm({}, 1)).toBe(false);
    });

    it('should enable the current and next column for the current selection', () => {
      frameworkService.list.set('board', boardColumn);
      frameworkService.list.set('medium', mediumColumn);
      frameworkService.currentSelection.next({ type: 'board', data: {} });
      expect(component.isCurrentOrNextTerm({}, 0)).toBe(true);
      expect(component.isCurrentOrNextTerm({}, 1)).toBe(true);
      expect(component.isCurrentOrNextTerm({}, 2)).toBe(false);
    });

    it('should emit draft terms for approval in the approval view', () => {
      spyOn(component.sentForApprove, 'emit');
      component.isApprovalView = true;
      component.draftTerms = [{ identifier: 't1' } as any];
      component.sendForApproval();
      expect(component.sentForApprove.emit).toHaveBeenCalledWith([{ identifier: 't1' }]);
    });

    it('should create an approval with the selected and draft terms', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      spyOn(snackBar, 'open');
      spyOn(approvalService, 'createApproval').and.returnValue(of({}));
      const selected = { identifier: 'b1', selected: true };
      frameworkService.list.set('board', { code: 'board', children: [selected, { identifier: 'b2' }] } as any);
      component.draftTerms = [{ identifier: 'd1' } as any];
      component.sendForApproval();
      expect(approvalService.createApproval).toHaveBeenCalledWith({ updateFieldValues: [selected, { identifier: 'd1' }] });
      expect(snackBar.open).toHaveBeenCalledWith('Terms successfully sent for Approval.', 'cancel');
    });

    it('should emit manageOrg for the manage-org card action', () => {
      spyOn(component.manageOrg, 'emit');
      component.cardActionEmit({ action: 'manage-org', data: { children: { code: 'o1' } } });
      expect(component.manageOrg.emit).toHaveBeenCalledWith({ code: 'o1' });
    });

    it('should detect child organisations', () => {
      component.orgSelectedData = { id: 'org1' };
      component.childOrgData = { rootOrgId: 'org1' };
      component.userRolesData = new Set<string>();
      expect(component.checkChildOrg()).toBe(false);
      component.childOrgData = { rootOrgId: 'org2' };
      expect(component.checkChildOrg()).toBe(true);
      component.childOrgData = { rootOrgId: 'org1' };
      component.userRolesData = new Set<string>(['mdo_admin']);
      expect(component.checkChildOrg()).toBe(true);
    });
  });

  describe('org hierarchy (v2) mode', () => {
    const orgData = { identifier: 'root', id: 'root', orgHierarchyFrameworkId: 'fw_root' };

    beforeEach(() => {
      component.orgSelectedData = orgData;
      component.childOrgData = { id: 'root' };
    });

    afterEach(() => {
      frameworkService.isOrgHierarchyMode = false;
    });

    it('should load the hierarchy through the v2 API', () => {
      fixture.detectChanges();
      expect(loadOrgHierarchySpy).toHaveBeenCalledWith(orgData, { id: 'root' });
    });

    it('should load the hierarchy even when the org has no orgHierarchyFrameworkId', () => {
      component.orgSelectedData = { identifier: 'root' };
      fixture.detectChanges();
      expect(loadOrgHierarchySpy).toHaveBeenCalled();
    });

    it('should emit frameWorkCreated true when the hierarchy read returns data', () => {
      loadOrgHierarchySpy.and.returnValue(of({ identifier: 'root', associations: [] } as any));
      const emitted: boolean[] = [];
      component.frameWorkCreated.subscribe(v => emitted.push(v));
      fixture.detectChanges();
      expect(emitted).toEqual([true]);
    });

    it('should emit frameWorkCreated false when the hierarchy read is empty', () => {
      const emitted: boolean[] = [];
      component.frameWorkCreated.subscribe(v => emitted.push(v));
      fixture.detectChanges();
      expect(emitted).toEqual([false]);
      expect(component.isFraworkLoading).toBe(false);
    });

    it('should emit frameWorkCreated false and stop loading when the hierarchy read fails', () => {
      spyOn(console, 'error');
      loadOrgHierarchySpy.and.returnValue(throwError(() => new Error('no framework')));
      const emitted: boolean[] = [];
      component.frameWorkCreated.subscribe(v => emitted.push(v));
      component.isLoading = true;
      fixture.detectChanges();
      expect(emitted).toEqual([false]);
      expect(component.isLoading).toBe(false);
      expect(component.isFraworkLoading).toBe(false);
    });

    it('should not stack loader subscriptions when init runs again', () => {
      fixture.detectChanges();
      const first = component.loaderSubscription;
      component.init();
      expect(first.closed).toBeTrue();
      expect(component.loaderSubscription.closed).toBeFalse();
    });

    it('should ask the service to load the children of a selected card', () => {
      spyOn(frameworkService, 'selectHierarchyParent');
      frameworkService.categoriesHash.next([{ code: 'level2' }, { code: 'level3' }] as any);
      const term = { identifier: 'a', code: 'a', category: 'level2', childCount: 3 };
      component.updateFinalList({ selectedTerm: term, isSelected: true });
      expect(frameworkService.selectHierarchyParent).toHaveBeenCalledWith('level2', term);
      expect(frameworkService.selectionList.get('level2')).toBe(term);
    });

    it('should show header counts from the API child counts', () => {
      frameworkService.isOrgHierarchyMode = true;
      frameworkService.categoriesHash.next([{ code: 'level2' }, { code: 'level3' }] as any);
      frameworkService.list.set('level2', { code: 'level2', index: 1, children: [{ identifier: 'a' }] } as any);
      frameworkService.list.set('level3', { code: 'level3', index: 2, children: [] } as any);
      spyOn(frameworkService, 'getHierarchyColumnState').and.returnValue({ total: 57 } as any);
      expect(component.getFirstColumnCount(frameworkService.list.get('level2'))).toBe(57);
      expect(component.getCount('level2')).toBe(57);
      expect(component.getCount('level3')).toBe(0);
      frameworkService.selectionList.set('level2', { identifier: 'a', childCount: 12 });
      expect(component.getCount('level3')).toBe(12);
    });

    it('should keep the column view for levels that hold orgs, as before', () => {
      frameworkService.isOrgHierarchyMode = true;
      expect(component.hasColumnContent({ code: 'level3', children: [], hasData: true })).toBeTrue();
      expect(component.hasColumnContent({ code: 'level9', children: [], hasData: false })).toBeFalse();
      expect(component.hasColumnContent({ code: 'level9', children: [{}], hasData: false })).toBeTrue();
    });

    it('should load the framework terms on demand before removing a connection', () => {
      frameworkService.isOrgHierarchyMode = true;
      const ensureSpy = spyOn(frameworkService, 'ensureOrgEditContext').and.returnValue(of(undefined));
      spyOn(frameworkService, 'toFrameworkTerm').and.returnValue({ code: 'T_A' });
      const assocSpy = spyOn(component, 'getSelectedTermsAssociation').and.returnValue([]);
      spyOn(TestBed.inject(MatSnackBar), 'open');
      component.removeConnection({ children: { identifier: 'a', additionalProperties: { orgId: 'a' } } });
      expect(ensureSpy).toHaveBeenCalledWith(orgData);
      expect(assocSpy).toHaveBeenCalledWith('T_A');
    });

    it('should show an error and not open the remove confirmation when the framework terms cannot be loaded', () => {
      frameworkService.isOrgHierarchyMode = true;
      spyOn(frameworkService, 'ensureOrgEditContext').and.returnValue(throwError(new Error('x')));
      const snackBar = TestBed.inject(MatSnackBar);
      spyOn(snackBar, 'open');
      spyOn(console, 'error');
      const dialogSpy = spyOn(component.dialog, 'open');
      component.removeConnection({ children: { identifier: 'a', additionalProperties: { orgId: 'a' } } });
      expect(dialogSpy).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith('Error in loading organisation hierarchy', 'cancel');
    });

    it('should open the add dialog without reading the framework', () => {
      frameworkService.isOrgHierarchyMode = true;
      frameworkService.list.set('level2', { code: 'level2', name: 'Ministry', index: 1 } as any);
      frameworkService.list.set('level3', { code: 'level3', name: 'Department', index: 2 } as any);
      frameworkService.selectionList.set('level2', { identifier: 'a', name: 'A', category: 'level2' });
      const ensureSpy = spyOn(frameworkService, 'ensureOrgEditContext');
      const readSpy = spyOn(frameworkService, 'getFrameworkRead');
      const dialogSpy = spyOn(component.dialog, 'open').and.returnValue({ afterClosed: () => of({ selectedOrg: [{ identifier: 'o1' }] }) } as any);
      const linkSpy = spyOn(component, 'linkOrganisations');
      const column = frameworkService.list.get('level3');
      component.openOrganizationDialog(column);
      expect(ensureSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
      expect(linkSpy).toHaveBeenCalledWith([{ identifier: 'o1' }], column);
      const data = (dialogSpy.calls.mostRecent().args[1] as any).data;
      expect(data.previous).toEqual([{ identifier: 'a', name: 'A', category: 'level2', categoryName: 'Ministry' }]);
      expect(data.currentData.code).toBe('level3');
      expect(data.currentData.categoryName).toBe('Department');
    });

    describe('link / unlink', () => {
      const success = { params: { status: 'SUCCESS' }, result: { message: 'ok' } };
      const failed = { params: { status: 'FAILED', errmsg: 'Organisation already linked' } };
      let treeSvc: TreeHierarchyService;
      let snackBar: MatSnackBar;
      let initSpy: jasmine.Spy;

      beforeEach(() => {
        treeSvc = TestBed.inject(TreeHierarchyService);
        snackBar = TestBed.inject(MatSnackBar);
        spyOn(snackBar, 'open');
        frameworkService.isOrgHierarchyMode = true;
        frameworkService.categoriesHash.next([{ code: 'level2' }, { code: 'level3' }] as any);
        initSpy = spyOn(component, 'init');
      });

      it('should link the selected orgs under the card selected in the previous column', fakeAsync(() => {
        const linkSpy = spyOn(treeSvc, 'linkOrgHierarchy').and.returnValue(of(success as any));
        frameworkService.selectionList.set('level2', { identifier: 'a', additionalProperties: { orgId: 'a' } });
        component.linkOrganisations([{ identifier: 'o1' }, { identifier: 'o2' }, { identifier: 'o1' }], { code: 'level3' });
        expect(linkSpy).toHaveBeenCalledWith('a', ['o1', 'o2']);
        expect(initSpy).not.toHaveBeenCalled();
        tick(5000);
        expect(snackBar.open).toHaveBeenCalledWith('Organization hierarchy updated successfully');
        expect(initSpy).toHaveBeenCalled();
      }));

      it('should link first-column orgs under the selected root org', () => {
        const linkSpy = spyOn(treeSvc, 'linkOrgHierarchy').and.returnValue(of(success as any));
        component.linkOrganisations([{ identifier: 'o1' }], { code: 'level2' });
        expect(linkSpy).toHaveBeenCalledWith('root', ['o1']);
      });

      it('should show the server error and stop the loader when linking fails', () => {
        spyOn(treeSvc, 'linkOrgHierarchy').and.returnValue(of(failed as any));
        const loaderSpy = spyOn(treeSvc, 'setLoaderState');
        component.linkOrganisations([{ identifier: 'o1' }], { code: 'level2' });
        expect(loaderSpy).toHaveBeenCalledWith(false);
        expect(snackBar.open).toHaveBeenCalledWith('Organisation already linked', 'cancel');
        expect(initSpy).not.toHaveBeenCalled();
      });

      it('should not call link without a parent org', () => {
        const linkSpy = spyOn(treeSvc, 'linkOrgHierarchy');
        component.linkOrganisations([{ identifier: 'o1' }], { code: 'level3' }); // nothing selected in level2
        expect(linkSpy).not.toHaveBeenCalled();
        expect(snackBar.open).toHaveBeenCalledWith('Error in creating term', 'cancel');
      });

      it('should only unlink the card org (no org/ext/v2/update) and reload the tree', fakeAsync(() => {
        const unlinkSpy = spyOn(treeSvc, 'unlinkOrgHierarchy').and.returnValue(of(success as any));
        const contentSpy = spyOn(treeSvc, 'orgContentUpdate');
        component.unlinkOrganisation({ identifier: 'a', additionalProperties: { orgId: 'a' } });
        tick();
        expect(unlinkSpy).toHaveBeenCalledWith('a', false);
        expect(contentSpy).not.toHaveBeenCalled();
        tick(5000);
        expect(snackBar.open).toHaveBeenCalledWith('Organization hierarchy updated successfully');
        expect(initSpy).toHaveBeenCalled();
      }));

      it('should unlink after the remove confirmation is accepted', () => {
        spyOn(frameworkService, 'ensureOrgEditContext').and.returnValue(of(undefined));
        spyOn(frameworkService, 'toFrameworkTerm').and.returnValue({ code: 'T_A' });
        spyOn(component, 'getSelectedTermsAssociation').and.returnValue([{ ids: ['T_A'] }, { ids: ['T_A1'] }]);
        spyOn(component.dialog, 'open').and.returnValue({ afterClosed: () => of(true) } as any);
        const unlinkSpy = spyOn(component, 'unlinkOrganisation');
        const card = { identifier: 'a', additionalProperties: { orgId: 'a' } };
        component.removeConnection({ children: card });
        expect(unlinkSpy).toHaveBeenCalledWith(card);
      });

      it('should keep the tree and show an error when unlink fails', fakeAsync(() => {
        spyOn(treeSvc, 'unlinkOrgHierarchy').and.returnValue(throwError({ error: { params: { status: 'FAILED', errmsg: null } } }));
        const contentSpy = spyOn(treeSvc, 'orgContentUpdate');
        spyOn(console, 'error');
        component.unlinkOrganisation({ identifier: 'a', additionalProperties: { orgId: 'a' } });
        tick(5000);
        expect(contentSpy).not.toHaveBeenCalled();
        expect(snackBar.open).toHaveBeenCalledWith('Failed to remove connection.', 'cancel');
        expect(initSpy).not.toHaveBeenCalled();
      }));
    });

    it('should cancel pending hierarchy requests on destroy', () => {
      fixture.detectChanges();
      frameworkService.isOrgHierarchyMode = true;
      const resetSpy = spyOn(frameworkService, 'resetHierarchyState');
      fixture.destroy();
      expect(resetSpy).toHaveBeenCalled();
    });
  });
});
