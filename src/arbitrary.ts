// spell-checker: ignore arbitraries
import { Int32, primitive, CodePoint as C } from "wiinuk-extensions"
import * as ex from "wiinuk-extensions"
import { Random } from "./random"

export interface SampleOptions {
    count?: number
    initialSize?: number
    delta?: number
    seed?: number
}

export interface ArrayArbitraryOptions<Min extends number> {
    readonly min: Min
}

export interface Arbitrary<T> {
    generate(random: Random, size: Int32): T
    shrink(value: T): Iterable<T>
}
export interface Discriminator<TOverall, T extends TOverall> {
    is(value: TOverall): value is T
}
export interface DiscriminatedArbitrary<TOverall, T extends TOverall> extends Arbitrary<T>, Discriminator<TOverall, T> {
}

const uncheckedDiscriminatedArbitrary = <TOverall, T extends TOverall>(arbitrary: Arbitrary<T>, is: (value: TOverall) => value is T): DiscriminatedArbitrary<TOverall, T> => {
    return new UncheckedDiscriminatedArbitrary(arbitrary, is)
}
class UncheckedDiscriminatedArbitrary<TOverall, T extends TOverall> implements DiscriminatedArbitrary<TOverall, T> {
    constructor(private readonly _arbitrary: Arbitrary<T>, private readonly _is: (value: TOverall) => value is T) {}
    generate(random: Random, size: Int32) { return this._arbitrary.generate(random, size) }
    shrink(value: T) { return this._arbitrary.shrink(value) }
    is(value: TOverall): value is T { return this._is(value) }
}
export namespace Arbitrary {
    export function nullable<T extends {} | undefined>(arbitrary: Arbitrary<T>) {
        return sum([
            pure(null),
            uncheckedDiscriminatedArbitrary(arbitrary, (x): x is T => x !== null),
        ])
    }
    export function optional<T extends {} | null>(arbitrary: Arbitrary<T>) {
        return sum([
            pure(void 0),
            uncheckedDiscriminatedArbitrary(arbitrary, (x): x is T => x !== void 0),
        ])
    }
    export function sample<T>(arbitrary: Arbitrary<T>, { count = 100, initialSize = 0, delta = 2, seed = (Date.now() >>> 0) }: SampleOptions = {}) {
        const xs: T[] = []
        const r = new Random(seed)

        for (let s = initialSize, i = 0; i < count; i++ , s += delta) {
            xs[i] = arbitrary.generate(r, s)
        }
        return xs
    }
    class Map<T, U> implements Arbitrary<U> {
        constructor(private readonly _arbitrary: Arbitrary<T>, private readonly _to: (x: T) => U, private readonly _from: (x: U) => T) {}
        generate(r: Random, n: Int32) { return this._to(this._arbitrary.generate(r, n)) }
        *shrink(value: U) {
            const to = this._to
            for (const v2 of this._arbitrary.shrink(this._from(value))) { yield to(v2) }
        }
    }
    export function map<T, U>(arbitrary: Arbitrary<T>, convertTo: (x: T) => U, convertFrom: (x: U) => T): Arbitrary<U> {
        return new Map(arbitrary, convertTo, convertFrom)
    }
    export function mapExtend<T, U extends T>(arbitrary: Arbitrary<T>, convertTo: (x: T) => U): Arbitrary<U> {
        return new Map(arbitrary, convertTo, x => x)
    }
    class Filter<T> implements Arbitrary<T> {
        constructor(
            private readonly _arbitrary: Arbitrary<T>,
            private readonly _predicate: (value: T) => boolean) {}

        generate(random: Random, size: Int32) {
            const { _arbitrary: arb, _predicate: pred } = this
            while (true) {
                const x = arb.generate(random, size)
                if (pred(x)) { return x }
            }
        }
        *shrink(value: T) {
            const predicate = this._predicate
            for (const x of this._arbitrary.shrink(value)) {
                if (predicate(x)) { yield x }
            }
        }
    }
    export function filter<T>(arbitrary: Arbitrary<T>, predicate: (value: T) => boolean): Arbitrary<T> {
        return new Filter(arbitrary, predicate)
    }

    class Pure<T> implements DiscriminatedArbitrary<unknown, T> {
        constructor(private readonly _value: T) {}
        is(this: Pure<primitive>, value: unknown): value is T {
            return value === this._value
        }
        generate() { return this._value }
        *shrink(): Iterable<T> { }
    }
    export function pure<T extends primitive>(value: T): DiscriminatedArbitrary<unknown, T>
    export function pure<T>(value: T): Arbitrary<T>
    export function pure<T>(value: T) { return new Pure(value) }

    class Elements<T extends primitive> implements Arbitrary<T> {
        private readonly _values: [T, ...T[]]
        constructor(value: T, ...values: T[]) {
            this._values = [value]
            this._values.push(...values)
        }
        generate(r: Random) {
            const vs = this._values
            return vs[r.next() * vs.length]
        }
        *shrink(value: T) {
            const vs = this._values
            for (let i = 0; i < vs.length; i++) {
                if (vs[i] === value) {
                    for (let j = i - 1; 0 <= j; j--) { yield vs[j] }
                    return
                }
            }
        }
    }
    export function elements<T extends primitive>(value: T, ...values: T[]): Arbitrary<T> {
        return new Elements(value, ...values)
    }

    export namespace CodePoint {
        export const enum Category {
            AsciiLower,
            AsciiUpper,
            AsciiNumber,
            AsciiWithoutLetterOrNumber,
            Latin1WithoutAscii,
            UnicodeWithoutLatin1,
        }
        export function category(c: C) {
            if (c <= C.AsciiMax) {
                if (C.a <= c && c <= C.z) { return Category.AsciiLower }
                if (C.A <= c && c <= C.Z) { return Category.AsciiUpper }
                return Category.AsciiWithoutLetterOrNumber
            }
            if (c <= C.Latin1Max) { return Category.UnicodeWithoutLatin1 }
            return Category.UnicodeWithoutLatin1
        }
    }

    function* shrinkInteger(n: number) {
        if (n === 0) { return }

        yield n - Math.sign(n)
        yield (n / 2) | 0
        yield 0
    }
    export const number: Arbitrary<number> = {
        generate(r, n) {
            n = n | 0
            const precision = 9999999999999
            return Math.trunc(r.range(-n * precision, n * precision)) / Math.trunc(r.range(1, precision))
        },
        *shrink(x) {
            if (x < 0) { yield -x }
            yield* shrinkInteger(Math.trunc(x))
        }
    }
    export const int32: Arbitrary<Int32> = {
        generate(r, size) { return r.range(-size, size) | 0 },
        shrink(x) { return shrinkInteger(x | 0) }
    }
    export const codePoint: Arbitrary<C> = {
        generate(r) {
            return (r.next() < 0.5) ? (r.range(C.Min, C.AsciiMax) | 0) : (r.range(C.Min, C.Latin1Max) | 0)
        },

        // a-z < A-Z < 0-9 < (\u0000...\u007F) < (\u0080..\u00FF) < ()
        *shrink(x) {
            function* chars(c: C) {
                yield Math.max(C.Min, c - 1)
                yield (c / 2) | 0
                yield C[" "]
                yield C["\n"]
                yield C._0
                yield C.a
            }

            const c = Math.max(C.Min, Math.min(C.Max, x | 0))
            const cat = CodePoint.category(c)
            for (var c2 of chars(c)) {
                const cat2 = CodePoint.category(c2)
                if (cat2 < cat || (cat2 === cat && c2 < c)) { yield c2 }
            }
        }
    }

    class ArrayMinMaxArbitrary<T> implements Arbitrary<Array<T>> {
        constructor(private readonly _arbitrary: Arbitrary<T>, private readonly _minLength: number) {}
        generate(r: Random, size: number) {
            let xs: T[] = []
            const count = Math.max(this._minLength, r.range(0, size) | 0)
            const arb = this._arbitrary
            for (let i = 0; i < count; i++) {
                xs[i] = arb.generate(r, size)
            }
            return xs
        }
        *shrink(xs: Array<T>) {
            if (xs.length === 0 || xs.length <= this._minLength) { return }

            // [1, 2, 3, 4]
            // => [1, 2]
            //   => [0, 2]
            //   => [1, 1]
            //   => [1, 0]
            // => [1]
            //   => [0]
            // => []
            const arb = this._arbitrary
            for (let i = (xs.length / 2) | 0; this._minLength <= i; i = (i / 2) | 0) {
                const xs2 = xs.slice(0, i)
                yield xs2

                for (let j = 0; j < i; j++) {
                    for (const x of arb.shrink(xs[j])) {
                        const xs3 = xs2.slice()
                        xs3[j] = x
                        yield xs3
                    }
                }
            }
        }
    }

    export function array<T>(arbitrary: Arbitrary<T>, options: ArrayArbitraryOptions<1>): Arbitrary<[T, ...T[]]>
    export function array<T>(arbitrary: Arbitrary<T>, options: ArrayArbitraryOptions<2>): Arbitrary<[T, T, ...T[]]>
    export function array<T>(arbitrary: Arbitrary<T>, options?: Partial<ArrayArbitraryOptions<number>>): Arbitrary<Array<T>>
    export function array<T>(arbitrary: Arbitrary<T>, { min = 0 } = {}): Arbitrary<Array<T>> { return new ArrayMinMaxArbitrary(arbitrary, min) }

    const charArray = Arbitrary.array(Arbitrary.codePoint)
    export const string: Arbitrary<string> = {
        generate(r, size) { return String.fromCodePoint(...charArray.generate(r, size)) },
        *shrink(xs) {
            for (const cs of charArray.shrink(ex.String.codePoints(xs))) {
                yield String.fromCodePoint(...cs)
            }
        }
    }
    class Interface<T> implements Arbitrary<T> {
        readonly _keys: (keyof T)[]
        constructor(private readonly _arbitraryMap: {[P in keyof T]: Arbitrary<T[P]> }) {
            this._keys = (Object.keys(_arbitraryMap) as (keyof T)[]).sort()
        }
        generate(r: Random, size: number) {
            const arbs = this._arbitraryMap
            const result: T = Object.create(arbs)
            for (const k of this._keys) { result[k] = arbs[k].generate(r, size) }
            return result
        }
        *shrink(xs: T) {
            for (const key of this._keys) {
                for (const x of this._arbitraryMap[key].shrink(xs[key])) {
                    yield Object.assign({}, xs, { [key]: x }) as T
                }
            }
        }
    }
    export function interface_<T>(arbitraryMap: {[P in keyof T]: Arbitrary<T[P]> }): Arbitrary<T> {
        return new Interface(arbitraryMap)
    }

    class Sum<T> implements Arbitrary<T> {
        constructor(private readonly _arbitraries: readonly [DiscriminatedArbitrary<T, T>, ...DiscriminatedArbitrary<T, T>[]]) {}
        generate(r: Random, size: number) {
            const arbs = this._arbitraries
            return arbs[(r.next() * arbs.length) | 0].generate(r, size)
        }
        *shrink(value: T) {
            for (const arb of this._arbitraries) {
                if (arb.is(value)) { yield* arb.shrink(value) }
            }
        }
    }

    class Tuple<T> implements Arbitrary<T[]> {
        constructor(private readonly _arbitraries: readonly Arbitrary<T>[]) {}

        generate(r: Random, n: Int32) {
            return this._arbitraries.map(arb => arb.generate(r, n))
        }
        *shrink(tuple: T[]) {
            const arbs = this._arbitraries
            if (tuple.length !== arbs.length) { return }

            for (let i = 0; i < arbs.length; i++) {
                for (const v2 of arbs[i].shrink(tuple[i])) {
                    const tuple2 = tuple.slice()
                    tuple2[i] = v2
                    yield tuple2
                }
            }
        }
    }

    export function tuple<TArbs extends readonly Arbitrary<any>[]>(arbitraries: TArbs) {
        type targetTuple = { -readonly [k in keyof TArbs]: TArbs[k] extends Arbitrary<infer t> ? t : never }
        return new Tuple<targetTuple[number]>(arbitraries) as Arbitrary<any[]> as Arbitrary<targetTuple>
    }

    export function sum<TArbs extends readonly [DiscriminatedArbitrary<any, any>, ...DiscriminatedArbitrary<any, any>[]]>(arbitraries: TArbs): Arbitrary<{ [k in keyof TArbs]: TArbs[k] extends DiscriminatedArbitrary<any, infer t> ? t : never }[number]> {
        return new Sum(arbitraries)
    }
}
