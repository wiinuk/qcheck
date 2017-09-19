import { UInt32 } from "wiinuk-extensions"


export function seedOfNow(): UInt32 {
    return Date.now() >>> 0
}

export class Random {

    // XorShift
    private _x: UInt32 = 123456789
    private _y: UInt32 = 362436069
    private _z: UInt32 = 521288629
    private _w: UInt32
    constructor(seed = seedOfNow()) { this._w = seed >>> 0 }

    nextUInt32(): UInt32 {
        const { _x, _w } = this
        let t = _x ^ (_x << 11)
        this._x = this._y
        this._y = this._z
        this._z = _w
        return (this._w = (_w ^ (_w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0
    }
    /**
     * [0..1)
     */
    next() {
        return this.nextUInt32() / UInt32.Max
    }
    /**
     * [min...max)
     */
    range(min: number, max: number) {
        if (max < min) { throw new Error(`min /* ${min} */ < max /* ${max} */`) }

        const lo = Math.min(min, max)
        const hi = Math.max(min, max)
        return lo + this.next() * (hi - lo)
    }
}