// ============================================================================
// Hex — Pure hex math functions. No storage access.
// See design/implementation/01_interfaces.md §Module 2.
//
// Coordinate system: storage coordinates (unsigned u8).
//   storage_q = axial_q + Q_OFFSET   (Q_OFFSET = 16)
//   storage_r = axial_r + R_OFFSET   (R_OFFSET = 0)
// Map dimensions: 32 wide × 20 tall.
//
// Axial hex directions (dq, dr):
//   0 = E  (+1,  0)    3 = W  (-1,  0)
//   1 = NE (+1, -1)    4 = SW (-1, +1)
//   2 = NW ( 0, -1)    5 = SE ( 0, +1)
// ============================================================================

use cairo_civ::types::{MAP_WIDTH, MAP_HEIGHT, Q_OFFSET, R_OFFSET};

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/// Hex distance between two positions in storage coordinates.
/// Uses axial formula: max(|dq|, |dr|, |dq + dr|).
pub fn hex_distance(q1: u8, r1: u8, q2: u8, r2: u8) -> u8 {
    let dq: i16 = q2.into() - q1.into();
    let dr: i16 = r2.into() - r1.into();
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

/// Returns neighbor positions (storage coords), filtered to in-bounds.
pub fn hex_neighbors(q: u8, r: u8) -> Array<(u8, u8)> {
    let mut result: Array<(u8, u8)> = array![];
    let qi: i16 = q.into();
    let ri: i16 = r.into();
    let w: i16 = MAP_WIDTH.into();
    let h: i16 = MAP_HEIGHT.into();

    // E: (q+1, r)
    if qi + 1 < w {
        result.append(((qi + 1).try_into().unwrap(), r));
    }
    // NE: (q+1, r-1)
    if qi + 1 < w && ri - 1 >= 0 {
        result.append(((qi + 1).try_into().unwrap(), (ri - 1).try_into().unwrap()));
    }
    // NW: (q, r-1)
    if ri - 1 >= 0 {
        result.append((q, (ri - 1).try_into().unwrap()));
    }
    // W: (q-1, r)
    if qi - 1 >= 0 {
        result.append(((qi - 1).try_into().unwrap(), r));
    }
    // SW: (q-1, r+1)
    if qi - 1 >= 0 && ri + 1 < h {
        result.append(((qi - 1).try_into().unwrap(), (ri + 1).try_into().unwrap()));
    }
    // SE: (q, r+1)
    if ri + 1 < h {
        result.append((q, (ri + 1).try_into().unwrap()));
    }

    result
}

// ---------------------------------------------------------------------------
// Bounds checking
// ---------------------------------------------------------------------------

/// Check if a storage coordinate is within map bounds.
pub fn in_bounds(q: u8, r: u8) -> bool {
    q < MAP_WIDTH && r < MAP_HEIGHT
}

// ---------------------------------------------------------------------------
// Line of Sight
// ---------------------------------------------------------------------------

/// Check line of sight between two hexes.
/// `blocking_tiles` is a span of (q, r) positions that block LOS
/// (mountains, woods, etc.). Endpoints never block.
pub fn has_line_of_sight(
    from_q: u8, from_r: u8,
    to_q: u8, to_r: u8,
    blocking_tiles: Span<(u8, u8)>,
) -> bool {
    let dist = hex_distance(from_q, from_r, to_q, to_r);
    if dist <= 1 {
        return true; // adjacent or same tile — nothing in between
    }

    // Convert to cube coordinates: x = q - offset, z = r, y = -x - z
    let offset: i16 = Q_OFFSET.into();
    let x1: i16 = from_q.into() - offset;
    let z1: i16 = from_r.into();
    let y1: i16 = -x1 - z1;
    let x2: i16 = to_q.into() - offset;
    let z2: i16 = to_r.into();
    let y2: i16 = -x2 - z2;
    let n: i16 = dist.into();

    // Walk intermediate tiles on the hex line (skip endpoints i=0 and i=n)
    let mut i: i16 = 1;
    loop {
        if i >= n {
            break true;
        }

        // Linearly interpolate cube coords, scaled by n
        let xn = x1 * (n - i) + x2 * i;
        let yn = y1 * (n - i) + y2 * i;
        let zn = z1 * (n - i) + z2 * i;

        // Round to nearest cube hex
        let mut rx = round_div_i16(xn, n);
        let mut ry = round_div_i16(yn, n);
        let mut rz = round_div_i16(zn, n);

        // Fix cube constraint: x + y + z must equal 0
        // Adjust the component with the largest rounding error
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

        // Convert back to storage coordinates
        let tq: i16 = rx + offset;
        let tr: i16 = rz;

        if tq >= 0 && tq < MAP_WIDTH.into() && tr >= 0 && tr < MAP_HEIGHT.into() {
            let tq_u8: u8 = tq.try_into().unwrap();
            let tr_u8: u8 = tr.try_into().unwrap();

            // Check if this intermediate tile blocks LOS
            let mut j: u32 = 0;
            let blen = blocking_tiles.len();
            let mut blocked = false;
            loop {
                if j >= blen {
                    break;
                }
                let (bq, br) = *blocking_tiles.at(j);
                if bq == tq_u8 && br == tr_u8 {
                    blocked = true;
                    break;
                }
                j += 1;
            };

            if blocked {
                break false;
            }
        }

        i += 1;
    }
}

// ---------------------------------------------------------------------------
// Hexes in range
// ---------------------------------------------------------------------------

/// Get all hexes within `radius` of (q, r), filtered to in-bounds.
/// Uses axial coordinate offsets: for each (dx, dr) where
/// max(|dx|, |dr|, |dx+dr|) <= radius, yield (q+dx, r+dr).
pub fn hexes_in_range(q: u8, r: u8, radius: u8) -> Array<(u8, u8)> {
    let mut result: Array<(u8, u8)> = array![];
    let rad: i16 = radius.into();
    let cq: i16 = q.into();
    let cr: i16 = r.into();
    let w: i16 = MAP_WIDTH.into();
    let h: i16 = MAP_HEIGHT.into();

    let mut dx: i16 = -rad;
    loop {
        if dx > rad {
            break;
        }

        // dr range: max(-rad, -rad - dx) .. min(rad, rad - dx)
        let lo_a: i16 = -rad;
        let lo_b: i16 = -rad - dx;
        let lo = if lo_a > lo_b { lo_a } else { lo_b };

        let hi_a: i16 = rad;
        let hi_b: i16 = rad - dx;
        let hi = if hi_a < hi_b { hi_a } else { hi_b };

        let mut dr: i16 = lo;
        loop {
            if dr > hi {
                break;
            }

            let sq: i16 = cq + dx;
            let sr: i16 = cr + dr;

            if sq >= 0 && sq < w && sr >= 0 && sr < h {
                result.append((sq.try_into().unwrap(), sr.try_into().unwrap()));
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
/// `river_edges_from` is a 6-bit bitmask (bit 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE).
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
// Coordinate conversion
// ---------------------------------------------------------------------------

/// Convert axial (signed) to storage (unsigned) coordinates.
pub fn axial_to_storage(q: i16, r: i16) -> (u8, u8) {
    let sq: u8 = (q + Q_OFFSET.into()).try_into().unwrap();
    let sr: u8 = (r + R_OFFSET.into()).try_into().unwrap();
    (sq, sr)
}

/// Convert storage (unsigned) to axial (signed) coordinates.
pub fn storage_to_axial(q: u8, r: u8) -> (i16, i16) {
    let aq: i16 = q.into() - Q_OFFSET.into();
    let ar: i16 = r.into() - R_OFFSET.into();
    (aq, ar)
}

// ---------------------------------------------------------------------------
// Direction between adjacent tiles
// ---------------------------------------------------------------------------

/// Get direction index (0-5) from one hex to an adjacent hex.
/// Returns None if not adjacent (distance != 1).
pub fn direction_between(from_q: u8, from_r: u8, to_q: u8, to_r: u8) -> Option<u8> {
    let dq: i16 = to_q.into() - from_q.into();
    let dr: i16 = to_r.into() - from_r.into();

    if dq == 1 && dr == 0 {
        Option::Some(0) // E
    } else if dq == 1 && dr == -1 {
        Option::Some(1) // NE
    } else if dq == 0 && dr == -1 {
        Option::Some(2) // NW
    } else if dq == -1 && dr == 0 {
        Option::Some(3) // W
    } else if dq == -1 && dr == 1 {
        Option::Some(4) // SW
    } else if dq == 0 && dr == 1 {
        Option::Some(5) // SE
    } else {
        Option::None
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
