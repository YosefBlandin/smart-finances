import { SnakeCaseToNormalPipe } from './snake-case-to-normal.pipe';

describe('SnakeCaseToNormalPipe', () => {
  it('create an instance', () => {
    const pipe = new SnakeCaseToNormalPipe();
    expect(pipe).toBeTruthy();
  });
});
