import { describe, test, expect } from 'bun:test';
import { AppService } from './app.service';

describe('AppService', () => {
  test('getHello returns Hello World!', () => {
    const service = new AppService();
    expect(service.getHello()).toBe('Hello World!');
  });
});
