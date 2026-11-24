import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { MaterialModule } from '../../../material.module';
import { FrameworkService } from '../../services/framework.service';
import { OrgHierarchyAddModalComponent } from './org-hierarchy-add-modal.component';

describe('OrgHierarchyAddModalComponent', () => {
  let component: OrgHierarchyAddModalComponent;
  let fixture: ComponentFixture<OrgHierarchyAddModalComponent>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<OrgHierarchyAddModalComponent>>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let frameworkServiceMock: any;
  let dialogData: any;

  const selectedOrgData = { identifier: 'state1', sbOrgType: 'state' };
  const apiOrg = (id: string, name: string) => ({ id, name, ministryOrStateId: 'state1', ministryOrStateName: 'State' });
  const option = (id: string, name: string) => ({ identifier: id, orgName: name, ministryOrStateId: 'state1', ministryOrStateName: 'State' });
  const page = (orgs: any[], pageNo = 0, count = orgs.length) => of({ count, page: pageNo, limit: 50, organizations: orgs });
  const ids = (list: any[]) => list.map((o: any) => o.identifier);

  function setup(data: any) {
    dialogData = data;
    TestBed.configureTestingModule({
      declarations: [OrgHierarchyAddModalComponent],
      imports: [MaterialModule, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: FrameworkService, useValue: frameworkServiceMock },
        { provide: MatSnackBar, useValue: snackBarSpy },
      ]
    });
    fixture = TestBed.createComponent(OrgHierarchyAddModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** Stand-in for the MatSelect whose panel is scrolled */
  function selectStub(scroll = { scrollTop: 0, clientHeight: 100, scrollHeight: 1000 }) {
    const panel = document.createElement('div');
    Object.defineProperty(panel, 'scrollTop', { get: () => scroll.scrollTop });
    Object.defineProperty(panel, 'clientHeight', { get: () => scroll.clientHeight });
    Object.defineProperty(panel, 'scrollHeight', { get: () => scroll.scrollHeight });
    return { select: { panel: { nativeElement: panel } } as any, panel, scroll };
  }

  beforeEach(() => {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);
    frameworkServiceMock = {
      getUnmappedOrgs: jasmine.createSpy('getUnmappedOrgs').and.returnValue(page([apiOrg('o1', 'Beta Org'), apiOrg('o2', 'Alpha Org')], 0, 120)),
    };
  });

  describe('add mode', () => {
    beforeEach(() => {
      setup({
        previous: [{ category: 'level2', categoryName: 'Ministry', code: 'm1', name: 'Ministry One' }],
        currentData: { code: 'level3', categoryName: 'Department' },
        selectedOrgData,
      });
    });

    it('should create without loading organisations until the dropdown opens', () => {
      expect(component).toBeTruthy();
      expect(frameworkServiceMock.getUnmappedOrgs).not.toHaveBeenCalled();
      expect(component.filteredOptions).toEqual([]);
    });

    it('should load page 0 when the dropdown opens and keep page / count', () => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledWith(selectedOrgData, { page: 0, limit: 50, query: '' });
      expect(ids(component.filteredOptions)).toEqual(['o1', 'o2']);
      expect(component.orgPage).toBe(0);
      expect(component.orgCount).toBe(120);
      expect(component.isOrgsLoading).toBe(false);
    });

    it('should append the next page when the dropdown is scrolled to the end', () => {
      const { select, panel, scroll } = selectStub();
      component.onOrgSelectOpenedChange(true, select);
      frameworkServiceMock.getUnmappedOrgs.and.returnValue(page([apiOrg('o3', 'Gamma Org')], 1, 120));

      panel.dispatchEvent(new Event('scroll')); // not at the end yet
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledTimes(1);

      scroll.scrollTop = 900;
      panel.dispatchEvent(new Event('scroll'));
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledWith(selectedOrgData, { page: 1, limit: 50, query: '' });
      expect(ids(component.filteredOptions)).toEqual(['o1', 'o2', 'o3']);
      expect(component.orgPage).toBe(1);
    });

    it('should not request more pages when all organisations are loaded', () => {
      frameworkServiceMock.getUnmappedOrgs.and.returnValue(page([apiOrg('o1', 'Beta Org')], 0, 1));
      component.onOrgSelectOpenedChange(true, selectStub().select);
      component.loadNextOrgPage();
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledTimes(1);
    });

    it('should search with a 500ms debounce, reset the page and keep selected organisations on top', fakeAsync(() => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      component.selectedOrgsControl.setValue(['o2']);
      frameworkServiceMock.getUnmappedOrgs.and.returnValue(page([apiOrg('o5', 'Delta Org')], 0, 1));

      component.searchControl.setValue('del');
      tick(300);
      component.searchControl.setValue('delta');
      tick(499);
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledTimes(1);
      tick(1);

      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledTimes(2);
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledWith(selectedOrgData, { page: 0, limit: 50, query: 'delta' });
      expect(ids(component.filteredOptions)).toEqual(['o2', 'o5']);
      expect(component.selectedOrgs).toEqual([option('o2', 'Alpha Org')]);
      expect(component.getNameOfOrg('o2')).toBe('Alpha Org');
    }));

    it('should reset page, search and selected list on close and keep the selection as added', fakeAsync(() => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      component.selectedOrgsControl.setValue(['o1']);
      component.searchControl.setValue('beta');
      tick(500);

      component.onOrgSelectOpenedChange(false, selectStub().select);
      expect(component.addedOrgs).toEqual([option('o1', 'Beta Org')]);
      expect(component.selectedOrgs).toEqual([]);
      expect(component.orgPage).toBe(0);
      expect(component.orgSearchKey).toBe('');
      expect(component.searchControl.value).toBe('');
      expect(ids(component.filteredOptions)).toEqual(['o1']);

      // reopening loads page 0 without search, added organisations stay on top
      frameworkServiceMock.getUnmappedOrgs.and.returnValue(page([apiOrg('o3', 'Gamma Org')], 0, 1));
      component.onOrgSelectOpenedChange(true, selectStub().select);
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledWith(selectedOrgData, { page: 0, limit: 50, query: '' });
      expect(ids(component.filteredOptions)).toEqual(['o1', 'o3']);
    }));

    it('should ignore a pending search once the dropdown is closed', fakeAsync(() => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      component.searchControl.setValue('beta');
      component.onOrgSelectOpenedChange(false, selectStub().select);
      tick(500);
      expect(frameworkServiceMock.getUnmappedOrgs).toHaveBeenCalledTimes(1);
    }));

    it('should show an error and stop paging when the API fails', () => {
      frameworkServiceMock.getUnmappedOrgs.and.returnValue(throwError(new Error('boom')));
      component.onOrgSelectOpenedChange(true, selectStub().select);
      expect(snackBarSpy.open).toHaveBeenCalledWith('Error in fetching organisations');
      expect(component.filteredOptions).toEqual([]);
      expect(component.isOrgsLoading).toBe(false);
      expect(component.hasMoreOrgs).toBe(false);
    });

    it('should close the dropdown on add only when an organisation is selected', () => {
      const select = jasmine.createSpyObj('MatSelect', ['close']);
      component.checkAndClose(select);
      expect(snackBarSpy.open).toHaveBeenCalledWith('Please select at least one organization');
      expect(select.close).not.toHaveBeenCalled();
      component.selectedOrgsControl.setValue(['o1']);
      component.checkAndClose(select);
      expect(select.close).toHaveBeenCalled();
    });

    it('should toggle select all', () => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      const event = new Event('click');
      component.toggleSelectAll(event);
      expect(component.selectedOrgsControl.value).toEqual(['o1', 'o2']);
      expect(component.isAllSelected()).toBe(true);
      component.toggleSelectAll(event);
      expect(component.selectedOrgsControl.value).toEqual([]);
      expect(component.isAllSelected()).toBe(false);
    });

    it('should remove a selected org from the added list', () => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      component.selectedOrgsControl.setValue(['o1', 'o2']);
      component.onOrgSelectOpenedChange(false, selectStub().select);
      component.removeOrg('o1');
      expect(component.selectedOrgsControl.value).toEqual(['o2']);
      expect(component.addedOrgs).toEqual([option('o2', 'Alpha Org')]);
      component.removeSelected('o2');
      expect(component.selectedOrgsControl.value).toEqual([]);
      expect(component.addedOrgs).toEqual([]);
    });

    it('should return the org name for an id', () => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      expect(component.getNameOfOrg('o2')).toBe('Alpha Org');
      expect(component.getNameOfOrg('unknown')).toBe('');
    });

    it('should block enter key in handlers', () => {
      const enter = new KeyboardEvent('keydown', { key: 'Enter' });
      expect(component.handleKeydown(enter)).toBe(false);
      expect(component.handleSearchKeydown(enter)).toBe(false);
      expect(component.handleKeydown(new KeyboardEvent('keydown', { key: 'a' }))).toBe(true);
    });

    it('should warn and not close when saving with no organisation selected', () => {
      component.onSave();
      expect(snackBarSpy.open).toHaveBeenCalledWith('Please select at least one organization');
      expect(dialogRefSpy.close).not.toHaveBeenCalled();
    });

    it('should close with the added organisations on save', () => {
      component.onOrgSelectOpenedChange(true, selectStub().select);
      component.selectedOrgsControl.setValue(['o2']);
      component.onOrgSelectOpenedChange(false, selectStub().select);
      component.onSave();
      expect(dialogRefSpy.close).toHaveBeenCalledWith({ selectedOrg: [option('o2', 'Alpha Org')] });
    });

    it('should label the levels with their level name', () => {
      const labels = Array.from(fixture.nativeElement.querySelectorAll('.orgTypeName')).map((el: any) => el.textContent.trim());
      expect(labels).toContain('ministry');
      expect(labels).toContain('department');
    });

    it('should close the dialog on close', () => {
      component.onClose();
      expect(dialogRefSpy.close).toHaveBeenCalledWith();
    });
  });
});
