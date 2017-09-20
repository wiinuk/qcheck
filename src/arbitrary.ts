import { Int32, Array1, Array2, primitive, CodePoint as C } from "wiinuk-extensions"
import * as ex from "wiinuk-extensions"
import { Random } from "./random"


export type Is<T, U extends T> = (x: T) => x is U

export interface SampleOptions {
    count?: number
    initialSize?: number
    delta?: number
    seed?: number
}

export interface ArbitraryCore<T> {
    generate(random: Random, size: Int32): T
    shrink(value: T): Iterable<T>
}
export interface Arbitrary<T> extends ArbitraryCore<T> {
    sample(options?: SampleOptions): T[]
}

export namespace Arbitrary {
    export function nullable<T extends {} | undefined>(arbitrary: Arbitrary<T>) {
        return sum(
            [pure(null), (x): x is null => x === null],
            [arbitrary, (x): x is T => x !== null],
        )
    }
    export function optional<T extends {} | null>(arbitrary: Arbitrary<T>) {
        return sum(
            [pure(void 0), (x): x is undefined => x === void 0],
            [arbitrary, (x): x is T => x !== void 0],
        )
    }
    abstract class ArbitraryDefaults<T> implements Arbitrary<T> {
        abstract generate(random: Random, size: Int32): T
        abstract shrink(value: T): Iterable<T>
        sample(options?: SampleOptions) { return sample(this, options) }
    }
    class Extend<T> extends ArbitraryDefaults<T> {
        constructor(private readonly _arbitrary: ArbitraryCore<T>) { super() }
        generate(random: Random, size: Int32) { return this._arbitrary.generate(random, size) }
        shrink(value: T) { return this._arbitrary.shrink(value) }
    }
    export function extend<T>(arbitrary: ArbitraryCore<T>): Arbitrary<T> {
        return new Extend(arbitrary)
    }
    export function sample<T>(arbitrary: ArbitraryCore<T>, { count = 100, initialSize = 0, delta = 2, seed = (Date.now() >>> 0) }: SampleOptions = {}) {
        const xs: T[] = []
        const r = new Random(seed)

        for (let s = initialSize, i = 0; i < count; i++ , s += delta) {
            xs[i] = arbitrary.generate(r, s)
        }
        return xs
    }
    class Map<T, U> extends ArbitraryDefaults<U> {
        constructor(private readonly _arbitrary: ArbitraryCore<T>, private readonly _to: (x: T) => U, private readonly _from: (x: U) => T) { super() }
        generate(r: Random, n: Int32) { return this._to(this._arbitrary.generate(r, n)) }
        *shrink(value: U) {
            const to = this._to
            for (const v2 of this._arbitrary.shrink(this._from(value))) { yield to(v2) }
        }
    }
    export function map<T, U>(arbitrary: ArbitraryCore<T>, convertTo: (x: T) => U, convertFrom: (x: U) => T): Arbitrary<U> {
        return new Map(arbitrary, convertTo, convertFrom)
    }
    export function mapExtend<T, U extends T>(arbitrary: ArbitraryCore<T>, convertTo: (x: T) => U): Arbitrary<U> {
        return new Map(arbitrary, convertTo, x => x)
    }
    class Filter<T> extends ArbitraryDefaults<T> {
        constructor(
            private readonly _arbitrary: ArbitraryCore<T>,
            private readonly _predicate: (value: T) => boolean) { super() }

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
    export function filter<T>(arbitrary: ArbitraryCore<T>, predicate: (value: T) => boolean): Arbitrary<T> {
        return new Filter(arbitrary, predicate)
    }

    class Pure<T> extends ArbitraryDefaults<T> {
        constructor(private readonly _value: T) { super() }
        generate() { return this._value }
        *shrink(): Iterable<T> { }
    }
    export function pure<T>(value: T): Arbitrary<T> { return new Pure(value) }

    class Elements<T extends primitive> extends ArbitraryDefaults<T> {
        private readonly _values: Array1<T>
        constructor(value: T, ...values: T[]) {
            super()
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
    export const number: Arbitrary<number> = extend({
        generate(r, n) {
            n = n | 0
            const prec = 9999999999999
            return Math.trunc(r.range(-n * prec, n * prec)) / Math.trunc(r.range(1, prec))
        },
        *shrink(x) {
            if (x < 0) { yield -x }
            yield* shrinkInteger(Math.trunc(x))
        }
    })
    export const int32: Arbitrary<Int32> = extend({
        generate(r, size) { return r.range(-size, size) | 0 },
        shrink(x) { return shrinkInteger(x | 0) }
    })
    export const codePoint: Arbitrary<C> = extend({
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
    })

    class ArrayMinMaxArbitrary<T> extends ArbitraryDefaults<Array<T>> {
        constructor(private readonly _arbitrary: ArbitraryCore<T>, private readonly _minLength: number) { super() }
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

    export function array1<T>(arbitrary: ArbitraryCore<T>) { return new ArrayMinMaxArbitrary(arbitrary, 1) as Arbitrary<any> as Arbitrary<Array1<T>> }
    export function array2<T>(arbitrary: ArbitraryCore<T>) { return new ArrayMinMaxArbitrary(arbitrary, 2) as Arbitrary<any> as Arbitrary<Array2<T>> }
    export function array<T>(arbitrary: ArbitraryCore<T>): Arbitrary<Array<T>> { return new ArrayMinMaxArbitrary(arbitrary, 0) }
    
    const charArray = Arbitrary.array(Arbitrary.codePoint)
    export const string: Arbitrary<string> = extend({
        generate(r, size) { return String.fromCodePoint(...charArray.generate(r, size)) },
        *shrink(xs) {
            for (const cs of charArray.shrink(ex.String.codePoints(xs))) {
                yield String.fromCodePoint(...cs)
            }
        }
    })
    class Interface<T> extends ArbitraryDefaults<T> {
        readonly _keys: (keyof T)[]
        constructor(private readonly _arbitraryMap: {[P in keyof T]: ArbitraryCore<T[P]> }) {
            super()
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
    export function interface_<T>(arbitraryMap: {[P in keyof T]: ArbitraryCore<T[P]> }): Arbitrary<T> {
        return new Interface(arbitraryMap)
    }

    class Sum<T> extends ArbitraryDefaults<T> {
        private readonly _arbitraries: Array1<[ArbitraryCore<T>, Is<T, T>]>

        constructor(arbitrary: [ArbitraryCore<T>, Is<T, T>], ...arbitraries: [ArbitraryCore<T>, Is<T, T>][]) {
            super()
            this._arbitraries = [arbitrary]
            this._arbitraries.push(...arbitraries)
        }
        generate(r: Random, size: number) {
            const arbs = this._arbitraries
            return arbs[r.next() * arbs.length][0].generate(r, size)
        }
        *shrink(value: T) {
            for (const [arb, is] of this._arbitraries) {
                if (is(value)) { yield* arb.shrink(value) }
            }
        }
    }

    class Tuple<T> extends ArbitraryDefaults<T[]> {
        private readonly _arbitraries: Array1<ArbitraryCore<T>>
        constructor(arbitrary1: ArbitraryCore<T>, ...arbitraries: ArbitraryCore<T>[]) {
            super()
            this._arbitraries = [arbitrary1]
            this._arbitraries.push(...arbitraries)
        }

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

    // ```F#
    // for i in 2..8 do
    // let f sep f = {1..i} |> Seq.map f |> String.concat sep
    // let g = f >> (>>) sprintf
    // let t = g " | " "T%d"
    // printfn "export function sum<%s>(%s): Arbitrary<%s>"
    //     (g ", " "T%d")
    //     (f ", " <| fun n -> sprintf "arbitrary%d: [ArbitraryCore<T%d>, Is<%s, T%d>]" n n t n)
    //     t
    // ```
    export function tuple<T1>(arbitrary1: ArbitraryCore<T1>): Arbitrary<[T1]>
    export function tuple<T1, T2>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>): Arbitrary<[T1, T2]>
    export function tuple<T1, T2, T3>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>): Arbitrary<[T1, T2, T3]>
    export function tuple<T1, T2, T3, T4>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>): Arbitrary<[T1, T2, T3, T4]>
    export function tuple<T1, T2, T3, T4, T5>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>): Arbitrary<[T1, T2, T3, T4, T5]>
    export function tuple<T1, T2, T3, T4, T5, T6>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>): Arbitrary<[T1, T2, T3, T4, T5, T6]>
    export function tuple<T1, T2, T3, T4, T5, T6, T7>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>): Arbitrary<[T1, T2, T3, T4, T5, T6, T7]>
    export function tuple<T1, T2, T3, T4, T5, T6, T7, T8>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>): Arbitrary<[T1, T2, T3, T4, T5, T6, T7, T8]>
    export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>): Arbitrary<[T1, T2, T3, T4, T5, T6, T7, T8, T9]>
    export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>, arbitrary10: ArbitraryCore<T10>): Arbitrary<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10]>
    export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>, arbitrary10: ArbitraryCore<T10>, arbitrary11: ArbitraryCore<T11>): Arbitrary<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11]>
    export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>, arbitrary10: ArbitraryCore<T10>, arbitrary11: ArbitraryCore<T11>, arbitrary12: ArbitraryCore<T12>): Arbitrary<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12]>
    export function tuple<T>(arbitrary: ArbitraryCore<T>, ...arbitraries: ArbitraryCore<T>[]): Arbitrary<T[]>
    export function tuple<T>(arbitrary: ArbitraryCore<T>, ...arbitraries: ArbitraryCore<T>[]): Arbitrary<T[]> {
        return new Tuple(arbitrary, ...arbitraries)
    }

    // ```F#
    // for i in 2..8 do
    // let f sep f = {1..i} |> Seq.map f |> String.concat sep
    // let g = f >> (>>) sprintf
    // let t = g " | " "T%d"
    // printfn "export function sum<%s>(%s): Arbitrary<%s>"
    //     (g ", " "T%d")
    //     (f ", " <| fun n -> sprintf "arbitrary%d: [ArbitraryCore<T%d>, Is<%s, T%d>]" n n t n)
    //     t
    // ```
    export function sum<T1, T2>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2, T2>]): Arbitrary<T1 | T2>
    export function sum<T1, T2, T3>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3, T3>]): Arbitrary<T1 | T2 | T3>
    export function sum<T1, T2, T3, T4>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4, T4>]): Arbitrary<T1 | T2 | T3 | T4>
    export function sum<T1, T2, T3, T4, T5>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 |
        T5, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5, T5>]): Arbitrary<T1 | T2 | T3 | T4 | T5>
    export function sum<T1, T2, T3, T4, T5, T6>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5 | T6, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 | T5 | T6, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5 | T6, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5 | T6, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5 | T6, T5>], arbitrary6: [ArbitraryCore<T6>, Is<T1 | T2 | T3 | T4 | T5 | T6, T6>]): Arbitrary<T1 | T2 | T3 | T4 | T5 | T6>
    export function sum<T1, T2, T3, T4, T5, T6, T7>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T5>], arbitrary6: [ArbitraryCore<T6>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T6>], arbitrary7: [ArbitraryCore<T7>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T7>]): Arbitrary<T1 | T2 | T3 | T4 | T5 | T6 | T7>
    export function sum<T1, T2, T3, T4, T5, T6, T7, T8>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T5>], arbitrary6: [ArbitraryCore<T6>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T6>], arbitrary7: [ArbitraryCore<T7>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T7>], arbitrary8: [ArbitraryCore<T8>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T8>]): Arbitrary<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8>
    export function sum<T>(arbitrary: [ArbitraryCore<T>, Is<T, T>], ...arbitraries: [ArbitraryCore<T>, Is<T, T>][]): Arbitrary<T>
    export function sum<T>(arbitrary: [ArbitraryCore<T>, Is<T, T>], ...arbitraries: [ArbitraryCore<T>, Is<T, T>][]): Arbitrary<T> {
        return new Sum(arbitrary, ...arbitraries)
    }
}
