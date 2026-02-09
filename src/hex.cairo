// ============================================================================
// Hex — Pure hex math functions. No storage access.
// See design/implementation/01_interfaces.md §Module 2.
//
// Coordinate system: offset coordinates (flat-top hexes, odd-q-down).
//   q = column (0 .. MAP_WIDTH-1)
//   r = row    (0 .. MAP_HEIGHT-1)
//   Odd columns (q%2==1) are shifted down by half a hex.
//
// Map dimensions: 32 wide × 20 tall.
//
// Offset-coordinate neighbor directions (depend on column parity):
// Even column (q%2==0):                Odd column (q%2==1):
//   0 = upper-right (+1, -1)             0 = upper-right (+1,  0)
//   1 = top         ( 0, -1)             1 = top         ( 0, -1)
//   2 = upper-left  (-1, -1)             2 = upper-left  (-1,  0)
//   3 = lower-left  (-1,  0)             3 = lower-left  (-1, +1)
//   4 = bottom      ( 0, +1)             4 = bottom      ( 0, +1)
//   5 = lower-right (+1,  0)             5 = lower-right (+1, +1)
// ============================================================================

use cairo_civ::types::{MAP_WIDTH, MAP_HEIGHT};

// ---------------------------------------------------------------------------
// Offset ↔ Axial conversion (needed for distance and range calculations)
// ---------------------------------------------------------------------------

/// Convert offset (col, row) to axial (aq, ar).
/// aq = q, ar = r - floor(q / 2).
fn offset_to_axial(q: u8, r: u8) -> (i16, i16) {
    let qi: i16 = q.into();
    let ri: i16 = r.into();
    (qi, ri - qi / 2)
}

/// Convert axial (aq, ar) to offset (col, row).
/// q = aq, r = ar + floor(aq / 2).
fn axial_to_offset(aq: i16, ar: i16) -> (i16, i16) {
    // Cairo's / truncates toward zero; we need floor division for negative aq.
    let half = if aq >= 0 { aq / 2 } else { (aq - 1) / 2 };
    (aq, ar + half)
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/// Hex distance between two positions in offset coordinates.
/// Converts to axial, then uses: max(|dq|, |dr|, |dq + dr|).
pub fn hex_distance(q1: u8, r1: u8, q2: u8, r2: u8) -> u8 {
    let (aq1, ar1) = offset_to_axial(q1, r1);
    let (aq2, ar2) = offset_to_axial(q2, r2);
    let dq: i16 = aq2 - aq1;
    let dr: i16 = ar2 - ar1;
    let ds: i16 = dq + dr;

    let adq = abs_i16(dq);
    let adr = abs_i16(dr);
    let ads = abs_i16(ds);

    let m1 = if adq > adr { adq } else { adr };
    let max_val = if m1 > ads { m1 } else { ads };
    max_val.try_into().unwrap()
}

// ---------------------------------------------------------------------------
// Neighbors
// ---------------------------------------------------------------------------

/// Returns neighbor positions (offset coords), filtered to in-bounds.
/// Uses even/odd column parity for flat-top hex grid with odd-q-down.
pub fn hex_neighbors(q: u8, r: u8) -> Array<(u8, u8)> {
    let mut result: Array<(u8, u8)> = array![];
    let qi: i16 = q.into();
    let ri: i16 = r.into();
    let w: i16 = MAP_WIDTH.into();
    let h: i16 = MAP_HEIGHT.into();
    let even = (qi % 2) == 0;

    if even {
        // Even column neighbors
        // upper-right: (q+1, r-1)
        if qi + 1 < w && ri - 1 >= 0 {
            result.append(((qi + 1).try_into().unwrap(), (ri - 1).try_into().unwrap()));
        }
        // top: (q, r-1)
        if ri - 1 >= 0 {
            result.append((q, (ri - 1).try_into().unwrap()));
        }
        // upper-left: (q-1, r-1)
        if qi - 1 >= 0 && ri - 1 >= 0 {
            result.append(((qi - 1).try_into().unwrap(), (ri - 1).try_into().unwrap()));
        }
        // lower-left: (q-1, r)
        if qi - 1 >= 0 {
            result.append(((qi - 1).try_into().unwrap(), r));
        }
        // bottom: (q, r+1)
        if ri + 1 < h {
            result.append((q, (ri + 1).try_into().unwrap()));
        }
        // lower-right: (q+1, r)
        if qi + 1 < w {
            result.append(((qi + 1).try_into().unwrap(), r));
        }
    } else {
        // Odd column neighbors
        // upper-right: (q+1, r)
        if qi + 1 < w {
            result.append(((qi + 1).try_into().unwrap(), r));
        }
        // top: (q, r-1)
        if ri - 1 >= 0 {
            result.append((q, (ri - 1).try_into().unwrap()));
        }
        // upper-left: (q-1, r)
        if qi - 1 >= 0 {
            result.append(((qi - 1).try_into().unwrap(), r));
        }
        // lower-left: (q-1, r+1)
        if qi - 1 >= 0 && ri + 1 < h {
            result.append(((qi - 1).try_into().unwrap(), (ri + 1).try_into().unwrap()));
        }
        // bottom: (q, r+1)
        if ri + 1 < h {
            result.append((q, (ri + 1).try_into().unwrap()));
        }
        // lower-right: (q+1, r+1)
        if qi + 1 < w && ri + 1 < h {
            result.append(((qi + 1).try_into().unwrap(), (ri + 1).try_into().unwrap()));
        }
    }

    result
}

// ---------------------------------------------------------------------------
// Bounds checking
// ---------------------------------------------------------------------------

/// Check if an offset coordinate is within map bounds.
pub fn in_bounds(q: u8, r: u8) -> bool {
    q < MAP_WIDTH && r < MAP_HEIGHT
}

// ---------------------------------------------------------------------------
// Line of Sight
// ---------------------------------------------------------------------------

/// Check line of sight between two hexes (offset coords).
/// `blocking_tiles` is a span of (q, r) positions that block LOS.
pub fn has_line_of_sight(
    from_q: u8, from_r: u8,
    to_q: u8, to_r: u8,
    blocking_tiles: Span<(u8, u8)>,
) -> bool {
    let dist = hex_distance(from_q, from_r, to_q, to_r);
    if dist <= 1 {
        return true;
    }

    // Convert offset to axial, then to cube for line drawing
    let (aq1, ar1) = offset_to_axial(from_q, from_r);
    let (aq2, ar2) = offset_to_axial(to_q, to_r);
    // Cube: x = aq, z = ar, y = -x - z
    let x1: i16 = aq1;
    let z1: i16 = ar1;
    let y1: i16 = -x1 - z1;
    let x2: i16 = aq2;
    let z2: i16 = ar2;
    let y2: i16 = -x2 - z2;
    let n: i16 = dist.into();

    let mut i: i16 = 1;
    let mut los_clear = true;
    while i < n && los_clear {
        let xn = x1 * (n - i) + x2 * i;
        let yn = y1 * (n - i) + y2 * i;
        let zn = z1 * (n - i) + z2 * i;

        let mut rx = round_div_i16(xn, n);
        let mut ry = round_div_i16(yn, n);
        let mut rz = round_div_i16(zn, n);

        let xd = abs_i16(rx * n - xn);
        let yd = abs_i16(ry * n - yn);
        let zd = abs_i16(rz * n - zn);

        if xd > yd && xd > zd {
            rx = -ry - rz;
        } else if yd > zd {
            ry = -rx - rz;
        } else {
            rz = -rx - ry;
        }

        // Cube back to axial: aq = rx, ar = rz, then to offset
        let (tq, tr) = axial_to_offset(rx, rz);

        if tq >= 0 && tq < MAP_WIDTH.into() && tr >= 0 && tr < MAP_HEIGHT.into() {
            let tq_u8: u8 = tq.try_into().unwrap();
            let tr_u8: u8 = tr.try_into().unwrap();

            let mut j: u32 = 0;
            let blen = blocking_tiles.len();
            while j < blen {
                let (bq, br) = *blocking_tiles.at(j);
                if bq == tq_u8 && br == tr_u8 {
                    los_clear = false;
                    break;
                }
                j += 1;
            };
        }

        i += 1;
    };
    los_clear
}

// ---------------------------------------------------------------------------
// Hexes in range
// ---------------------------------------------------------------------------

/// Get all hexes within `radius` of (q, r) in offset coords, filtered to in-bounds.
/// Converts center to axial, iterates axial offsets, converts back to offset.
pub fn hexes_in_range(q: u8, r: u8, radius: u8) -> Array<(u8, u8)> {
    let mut result: Array<(u8, u8)> = array![];
    let rad: i16 = radius.into();
    let (caq, car) = offset_to_axial(q, r);
    let w: i16 = MAP_WIDTH.into();
    let h: i16 = MAP_HEIGHT.into();

    let mut dx: i16 = -rad;
    while dx <= rad {
        let lo_a: i16 = -rad;
        let lo_b: i16 = -rad - dx;
        let lo = if lo_a > lo_b { lo_a } else { lo_b };

        let hi_a: i16 = rad;
        let hi_b: i16 = rad - dx;
        let hi = if hi_a < hi_b { hi_a } else { hi_b };

        let mut dr: i16 = lo;
        while dr <= hi {
            let aq: i16 = caq + dx;
            let ar: i16 = car + dr;
            let (oq, or) = axial_to_offset(aq, ar);

            if oq >= 0 && oq < w && or >= 0 && or < h {
                result.append((oq.try_into().unwrap(), or.try_into().unwrap()));
            }

            dr += 1;
        };

        dx += 1;
    };
    result
}

// ---------------------------------------------------------------------------
// River crossing
// ---------------------------------------------------------------------------

/// Check if two adjacent hexes share a river edge.
/// `river_edges_from` is a 6-bit bitmask (bit i = direction i has river).
pub fn is_river_crossing(
    from_q: u8, from_r: u8,
    to_q: u8, to_r: u8,
    river_edges_from: u8,
) -> bool {
    match direction_between(from_q, from_r, to_q, to_r) {
        Option::Some(dir) => {
            let mask = bit_mask_u8(dir);
            (river_edges_from & mask) != 0
        },
        Option::None => false,
    }
}

// ---------------------------------------------------------------------------
// Coordinate conversion (public, for external use)
// ---------------------------------------------------------------------------

/// Convert axial (signed) to storage/offset (unsigned) coordinates.
pub fn axial_to_storage(q: i16, r: i16) -> (u8, u8) {
    let (oq, or) = axial_to_offset(q, r);
    (oq.try_into().unwrap(), or.try_into().unwrap())
}

/// Convert storage/offset (unsigned) to axial (signed) coordinates.
pub fn storage_to_axial(q: u8, r: u8) -> (i16, i16) {
    offset_to_axial(q, r)
}

// ---------------------------------------------------------------------------
// Direction between adjacent tiles
// ---------------------------------------------------------------------------

/// Get direction index (0-5) from one hex to an adjacent hex (offset coords).
/// Direction indices match the neighbor order defined at the top of this file.
/// Returns None if not adjacent (hex_distance != 1).
pub fn direction_between(from_q: u8, from_r: u8, to_q: u8, to_r: u8) -> Option<u8> {
    let dq: i16 = to_q.into() - from_q.into();
    let dr: i16 = to_r.into() - from_r.into();
    let even: bool = (from_q % 2) == 0;

    if even {
        // Even column
        if dq == 1 && dr == -1 {
            Option::Some(0) // upper-right
        } else if dq == 0 && dr == -1 {
            Option::Some(1) // top
        } else if dq == -1 && dr == -1 {
            Option::Some(2) // upper-left
        } else if dq == -1 && dr == 0 {
            Option::Some(3) // lower-left
        } else if dq == 0 && dr == 1 {
            Option::Some(4) // bottom
        } else if dq == 1 && dr == 0 {
            Option::Some(5) // lower-right
        } else {
            Option::None
        }
    } else {
        // Odd column
        if dq == 1 && dr == 0 {
            Option::Some(0) // upper-right
        } else if dq == 0 && dr == -1 {
            Option::Some(1) // top
        } else if dq == -1 && dr == 0 {
            Option::Some(2) // upper-left
        } else if dq == -1 && dr == 1 {
            Option::Some(3) // lower-left
        } else if dq == 0 && dr == 1 {
            Option::Some(4) // bottom
        } else if dq == 1 && dr == 1 {
            Option::Some(5) // lower-right
        } else {
            Option::None
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn abs_i16(x: i16) -> i16 {
    if x >= 0 { x } else { -x }
}

/// Round a/b to nearest integer (assumes b > 0).
fn round_div_i16(a: i16, b: i16) -> i16 {
    if a >= 0 {
        (2 * a + b) / (2 * b)
    } else {
        (2 * a - b) / (2 * b)
    }
}

/// 2^bit for bit indices 0..7.
fn bit_mask_u8(bit: u8) -> u8 {
    if bit == 0 { 1 }
    else if bit == 1 { 2 }
    else if bit == 2 { 4 }
    else if bit == 3 { 8 }
    else if bit == 4 { 16 }
    else if bit == 5 { 32 }
    else if bit == 6 { 64 }
    else { 128 }
}
