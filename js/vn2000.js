// WGS84 <-> VN-2000 (TM-3, central meridian 108°30', k0 = 0.9999) — Gia Lai (old province), EPSG:9218
// Datum shift: 7-parameter Helmert (VN-2000 -> WGS84), parameters published with Decision 05/2007/QĐ-BTNMT.
(function (root) {
  const a = 6378137.0, f = 1 / 298.257223563, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const LON0 = 108.5 * Math.PI / 180, K0 = 0.9999, FE = 500000, FN = 0;
  const SEC = Math.PI / (180 * 3600);
  const H = { tx: -191.90441429, ty: -39.30318279, tz: -111.45032835,
            rx: -0.00928836 * SEC, ry: 0.01975479 * SEC, rz: -0.00427372 * SEC, s: 0.252906278e-6 };

  function toEcef(lat, lon, h) {
    const sl = Math.sin(lat), N = a / Math.sqrt(1 - e2 * sl * sl);
    return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * sl];
  }
  function fromEcef(x, y, z) {
    const lon = Math.atan2(y, x), p = Math.hypot(x, y);
    let lat = Math.atan2(z, p * (1 - e2)), h = 0;
    for (let i = 0; i < 8; i++) {
      const sl = Math.sin(lat), N = a / Math.sqrt(1 - e2 * sl * sl);
      h = p / Math.cos(lat) - N;
      lat = Math.atan2(z, p * (1 - e2 * N / (N + h)));
    }
    return [lat, lon, h];
  }
  // Position-vector convention; dir = +1 VN2000->WGS84, -1 inverse (small-angle)
  function helmert([x, y, z], dir) {
    const k = dir, rx = H.rx * k, ry = H.ry * k, rz = H.rz * k, m = 1 + H.s * k;
    return [k * H.tx + m * (x - rz * y + ry * z),
            k * H.ty + m * (rz * x + y - rx * z),
            k * H.tz + m * (-ry * x + rx * y + z)];
  }
  function mArc(phi) {
    const e4 = e2 * e2, e6 = e4 * e2;
    return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  }
  function tmForward(lat, lon) {
    const s = Math.sin(lat), c = Math.cos(lat), t = Math.tan(lat);
    const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = (lon - LON0) * c;
    const x = K0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const y = K0 * (mArc(lat) + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return [FE + x, FN + y];
  }
  function tmInverse(E, Nn) {
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const M = (Nn - FN) / K0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
    const C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5;
    const D = (E - FE) / (N1 * K0);
    const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = LON0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
    return [lat, lon];
  }
  const R = Math.PI / 180;
  // Geodetic datum shift only (degrees in, degrees out)
  function wgsToVnGeo(latD, lonD) { const [la, lo] = fromEcef(...helmert(toEcef(latD * R, lonD * R, 0), -1)); return [la / R, lo / R]; }
  function vnGeoToWgs(latD, lonD) { const [la, lo] = fromEcef(...helmert(toEcef(latD * R, lonD * R, 0), +1)); return [la / R, lo / R]; }
  // Full: WGS84 lat/lon -> VN-2000 projected {X: northing, Y: easting} (Vietnamese convention)
  function wgsToVn2000(latD, lonD) { const [la, lo] = wgsToVnGeo(latD, lonD); const [E, N] = tmForward(la * R, lo * R); return { X: N, Y: E }; }
  function vn2000ToWgs(X, Y) { const [la, lo] = tmInverse(Y, X); return vnGeoToWgs(la / R, lo / R); }
  root.VN2000 = { wgsToVn2000, vn2000ToWgs, wgsToVnGeo, vnGeoToWgs, tmForward, tmInverse };
})(typeof window !== 'undefined' ? window : globalThis);
