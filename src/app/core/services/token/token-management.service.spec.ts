import { TestBed } from '@angular/core/testing';

import { TokenManagementService } from './token-management.service';

describe('TokenManagementService', () => {
  let service: TokenManagementService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TokenManagementService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
