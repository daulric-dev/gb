import { describe, expect, test } from 'bun:test';
import { haversineMeters, withinGeofence } from './geo';

describe('haversineMeters', () => {
  test('zero for the same point', () => {
    expect(haversineMeters({ latitude: 1, longitude: 2 }, { latitude: 1, longitude: 2 })).toBe(0);
  });

  test('one degree of latitude is about 111.2 km', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  test('London to Paris is about 344 km, either way round', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    const d = haversineMeters(london, paris);
    expect(d).toBeGreaterThan(342_000);
    expect(d).toBeLessThan(346_000);
    expect(haversineMeters(paris, london)).toBeCloseTo(d, 6);
  });

  test('handles the antimeridian', () => {
    const d = haversineMeters(
      { latitude: 0, longitude: 179.9995 },
      { latitude: 0, longitude: -179.9995 },
    );
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe('withinGeofence', () => {
  const center = { latitude: 51.5, longitude: -0.12 };
  // ~0.0009 deg latitude ≈ 100 m.
  const at = (m: number) => ({ latitude: 51.5 + (m / 111_195), longitude: -0.12 });

  test('inside the radius', () => {
    expect(withinGeofence(center, 100, at(90)).ok).toBe(true);
  });

  test('accuracy widens the fence, but by 50 m at most', () => {
    expect(withinGeofence(center, 100, at(130)).ok).toBe(false);
    expect(withinGeofence(center, 100, { ...at(130), accuracy: 40 }).ok).toBe(true);
    expect(withinGeofence(center, 100, { ...at(160), accuracy: 1000 }).ok).toBe(false);
    expect(withinGeofence(center, 100, { ...at(145), accuracy: 1000 }).ok).toBe(true);
  });

  test('reports the distance', () => {
    expect(withinGeofence(center, 100, at(200)).distanceM).toBeCloseTo(200, 0);
  });
});
