import { mixed, Nullable, Optional, Array1, Array2, ReadonlyArray1, ReadonlyArray2, primitive, Int32, CodePoint } from "wiinuk-extensions"
import { seedOfNow, Random } from "./random"
import { Is, ArbitraryCore, Arbitrary, ArrayArbitraryOptions } from "./arbitrary"

export { Int32, CodePoint } from "wiinuk-extensions"
export { Random } from "./random"
export { Is, SampleOptions, ArbitraryCore, Arbitrary } from "./arbitrary"


export interface Show<T> {
    stringify(value: T): string
}
namespace Show {
    export const any: Show<mixed> = {
        stringify(value) { return String(value) }
    }
}

export class ResultBase {
    constructor(
        readonly value: string,
        readonly labels: Set<string> | null
    ) { }
}
export class Failure extends ResultBase {
    protected readonly _failure = null
    readonly type = "Failure"
}
export class Success extends ResultBase {
    protected readonly _success = null
    readonly type = "Success"
}
export class Exception extends ResultBase {
    protected readonly _exception = null
    readonly type = "Exception"
    constructor(
        readonly error: any,
        value: string,
        labels: Set<string> | null,
    ) {
        super(value, labels)
    }
}
type Result =
    | Failure
    | Success
    | Exception

namespace Result {
    export function failure({ value, labels }: ResultBase): Failure {
        return new Failure(value, labels)
    }
    export function success({ value, labels }: ResultBase): Success {
        return new Success(value, labels)
    }
    export function exception(error: any, { value, labels }: ResultBase): Exception {
        return new Exception(error, value, labels)
    }
}

export interface TestResultBase<T> {
    readonly show: Show<T>
    readonly seed: number
    readonly testCount: number
}
export interface TestFailureArgs<T> extends TestResultBase<T> {
    readonly shrinkCount: number
    readonly originalFail: T
    readonly minFail: T
}
export interface TestFailure<T> extends TestFailureArgs<T> {
    readonly type: "Failure"
}
export interface TestFailureWithExceptionArgs<T> extends TestFailureArgs<T> {
    readonly error: any
}
export interface TestFailureWithException<T> extends TestFailureWithExceptionArgs<T> {
    readonly type: "Exception"
}
export interface TestSuccessArgs<T> extends TestResultBase<T> {
}
export interface TestSuccess<T> extends TestSuccessArgs<T> {
    readonly type: "Success"
}
export type TestResult<T> =
    | TestFailure<T>
    | TestFailureWithException<T>
    | TestSuccess<T>

export namespace TestResult {
    export function testFailure<T>(args: TestFailureArgs<T>): TestFailure<T> {
        return { ...args, type: "Failure" }
    }
    export function testSuccess<T>(args: TestSuccessArgs<T>): TestSuccess<T> {
        return { ...args, type: "Success" }
    }
}

export interface Runner {
    onShrink(shrinkCount: number, maxValue: string, currentValue: string): void
    onTest(testCount: number, currentValue: string): void
    onFinish<T>(result: TestResult<T>): void
}
export namespace Runner {
    export function fromFunction(log: (message: string) => void): Runner {
        return {
            onShrink(shrinkCount, maxValue, value) {
                log(`shrink[${shrinkCount}]: ${maxValue} => ${value}`)
            },
            onTest(testCount, currentValue) {
                log(`${testCount}: ${currentValue}`)
            },
            onFinish(result) {
                if (result.type === "Success") { return log(`Ok passed ${result.testCount} tests.`) }

                const { show, testCount, shrinkCount, seed, originalFail, minFail } = result
                log(`Falsifiable, after ${testCount} tests (${shrinkCount} shrink) (seed: ${seed}):`)
                log(`Original: ${show.stringify(originalFail)}`)
                log(`Shrunk: ${show.stringify(minFail)}`)

                if (result.type === "Exception") {
                    log(`with exception: ${result.error}`)
                }
            }
        }
    }
    export const console = fromFunction(global.console.log)
}

export interface Config {
    readonly seed?: number
    readonly maxTest: number
    readonly startSize: number
    readonly endSize: number
    readonly runner?: Runner
}
export namespace Config {
    export const defaultValue: Config = Object.freeze({
        maxTest: 100,
        startSize: 1,
        endSize: 100,
    })
}

function currentSize(startSize: number, endSize: number, maxTest: number, index: number) {
    return startSize + (endSize - startSize) * ((index + 1) / maxTest) | 0
}

interface State<T> {
    readonly seed: number
    readonly arb: ArbitraryCore<T>
    readonly show: Show<T>
    readonly test: (value: T) => any
    readonly testCount: number
    readonly runner: Runner
}

function runTest<T>({ test, show }: State<T>, value: T) {
    try {
        const r = test(value)
        if (r instanceof Failure || r instanceof Success || r instanceof Exception) { return r }
        if (r === false) { return Result.failure({ value: show.stringify(value), labels: null }) }
        return Result.success({ value: show.stringify(value), labels: null })
    }
    catch (e) {
        return Result.exception(e, { value: show.stringify(value), labels: null })
    }
}

function findLocalMinFail<T>(state: State<T>, originalFail: T): TestResult<T> {
    const { runner, arb, seed, show, testCount } = state
    let shrinkCount = 0
    let maxFail = originalFail
    let minFail = maxFail
    let failCount = 0

    findMin: while (true) {
        for (const v of arb.shrink(maxFail)) {
            runner.onShrink(shrinkCount, show.stringify(maxFail), show.stringify(v))
            const r = runTest(state, v)

            if (r.type === "Success") {
                if (failCount === 0) { break findMin }

                maxFail = minFail
                failCount = 0
                continue findMin
            }
            else {
                failCount++
                shrinkCount++
                minFail = v
            }
        }
        break findMin
    }
    return TestResult.testFailure({ shrinkCount, originalFail, minFail, seed, show, testCount })
}

function check<T>(arb: ArbitraryCore<T>, show: Show<T>, test: (value: T) => any, { seed = seedOfNow(), maxTest, startSize, endSize, runner = Runner.console } = Config.defaultValue) {
    const
        random = new Random(seed),
        minSize = Math.max(1, startSize),
        maxSize = Math.max(endSize, minSize)

    for (let testCount = 0; testCount < maxTest; testCount++) {
        const size = currentSize(minSize, maxSize, maxTest, testCount)
        const v = arb.generate(random, size)
        runner.onTest(testCount, show.stringify(v))
        const r = runTest({ arb, show, test, testCount, seed, runner }, v)
        if (r.type === "Success") { continue }

        const testResult = findLocalMinFail({ arb, show, test, testCount: testCount + 1, seed, runner }, v)
        runner.onFinish(testResult)
        return testResult
    }
    return TestResult.testSuccess({ seed, show, testCount: maxTest })
}

export interface Checker<T> extends Arbitrary<T>, Show<T> {
    check(test: (value: T) => any, config?: Config): TestResult<T>

    array(options: ArrayArbitraryOptions<1>): Checker<Array1<T>>
    array(options: ArrayArbitraryOptions<2>): Checker<Array2<T>>
    array(options?: Partial<ArrayArbitraryOptions<number>>): Checker<T[]>

    readonlyArray(options: ArrayArbitraryOptions<1>): Checker<ReadonlyArray1<T>>
    readonlyArray(options: ArrayArbitraryOptions<2>): Checker<ReadonlyArray2<T>>
    readonlyArray(options?: Partial<ArrayArbitraryOptions<number>>): Checker<ReadonlyArray<T>>

    map<U extends T>(convertTo: (value: T) => U, convertFrom?: (value: U) => T): Checker<U>
    map<U>(convertTo: (value: T) => U, convertFrom: (value: U) => T): Checker<U>
    filter(predicate: (value: T) => boolean): Checker<T>

    nullable<A extends {} | undefined>(this: Checker<A>): Checker<Nullable<A>>
    optional<A extends {} | null>(this: Checker<A>): Checker<Optional<A>>
}

class FromArbitrary<T> extends Arbitrary.Extend<T> implements Checker<T> {
    constructor (arbitrary: ArbitraryCore<T>) { super(arbitrary) }

    check(this: Checker<T>, test: (value: T) => any, config?: Config): TestResult<T> { return check(this, this, test, config) }
    
    
    array(options: ArrayArbitraryOptions<1>): Checker<Array1<T>>
    array(options: ArrayArbitraryOptions<2>): Checker<Array2<T>>
    array(options?: Partial<ArrayArbitraryOptions<number>>): Checker<T[]>
    array(options?: Partial<ArrayArbitraryOptions<number>>): Checker<T[]> { return array(this, options) }

    readonlyArray(options: ArrayArbitraryOptions<1>): Checker<ReadonlyArray1<T>>
    readonlyArray(options: ArrayArbitraryOptions<2>): Checker<ReadonlyArray2<T>>
    readonlyArray(options?: Partial<ArrayArbitraryOptions<number>>): Checker<ReadonlyArray<T>>
    readonlyArray(options?: Partial<ArrayArbitraryOptions<number>>): Checker<ReadonlyArray<T>> {
        return array(this, options) as Checker<ReadonlyArray<T>>
    }
    
    map<U extends T>(convertTo: (value: T) => U, convertFrom?: (value: U) => T): Checker<U>
    map<U>(convertTo: (value: T) => U, convertFrom: (value: U) => T): Checker<U>
    map(convertTo: any, convertFrom?: any): Checker<any> { return fromArbitrary(super.map(convertTo, convertFrom)) }
    filter(predicate: (value: T) => boolean): Checker<T> { return fromArbitrary(super.filter(predicate)) }

    nullable<A extends {} | undefined>(this: Arbitrary<A>): Checker<Nullable<A>> { return fromArbitrary(super.nullable() as any as Arbitrary<Nullable<A>>) }
    optional<A extends {} | null>(this: Arbitrary<A>): Checker<Optional<A>> { return fromArbitrary(super.optional() as any as Arbitrary<Optional<A>>) }

    stringify(value: T): string { return Show.any.stringify(value) }
}

export function fromArbitrary<T>(arbitrary: ArbitraryCore<T>): Checker<T> {
    return new FromArbitrary(arbitrary)
}

export function pure(value: null): Checker<null>
export function pure(value: undefined): Checker<undefined>
export function pure<T extends string | number | boolean>(value: T): Checker<T>
export function pure<T>(value: T): Checker<T>
export function pure<T>(value: T) { return fromArbitrary(Arbitrary.pure(value)) }

export function elements<T extends primitive>(value: T, ...values: T[]) { return fromArbitrary(Arbitrary.elements(value, ...values)) }

export const number = fromArbitrary(Arbitrary.number)
export const int32: Checker<Int32> = fromArbitrary(Arbitrary.int32)
export const codePoint: Checker<CodePoint> = fromArbitrary(Arbitrary.codePoint)

export function array<T>(arbitrary: ArbitraryCore<T>, options: ArrayArbitraryOptions<1>): Checker<Array1<T>>
export function array<T>(arbitrary: ArbitraryCore<T>, options: ArrayArbitraryOptions<2>): Checker<Array2<T>>
export function array<T>(arbitrary: ArbitraryCore<T>, options?: Partial<ArrayArbitraryOptions<number>>): Checker<T[]>
export function array<T>(arbitrary: ArbitraryCore<T>, options?: Partial<ArrayArbitraryOptions<number>>) { return fromArbitrary(Arbitrary.array(arbitrary)) }

export const string = fromArbitrary(Arbitrary.string)
export function interface_<T>(arbitraryMap: {[P in keyof T]: ArbitraryCore<T[P]> }) { return fromArbitrary(Arbitrary.interface_<T>(arbitraryMap)) }

// ```F#
// for i in 1..12 do
//     let f sep f = {1..i} |> Seq.map f |> String.concat sep
//     let ts = f ", " <| sprintf "T%d"
//     printfn "export function tuple<%s>(%s): Checker<[%s]>"
//         ts
//         (f ", " <| fun n -> sprintf "arbitrary%d: Arbitrary<T%d>" n n)
//         ts
// ```
export function tuple<T1>(arbitrary1: ArbitraryCore<T1>): Checker<[T1]>
export function tuple<T1, T2>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>): Checker<[T1, T2]>
export function tuple<T1, T2, T3>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>): Checker<[T1, T2, T3]>
export function tuple<T1, T2, T3, T4>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>): Checker<[T1, T2, T3, T4]>
export function tuple<T1, T2, T3, T4, T5>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>): Checker<[T1, T2, T3, T4, T5]>
export function tuple<T1, T2, T3, T4, T5, T6>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>): Checker<[T1, T2, T3, T4, T5, T6]>
export function tuple<T1, T2, T3, T4, T5, T6, T7>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>): Checker<[T1, T2, T3, T4, T5, T6, T7]>
export function tuple<T1, T2, T3, T4, T5, T6, T7, T8>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>): Checker<[T1, T2, T3, T4, T5, T6, T7, T8]>
export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>): Checker<[T1, T2, T3, T4, T5, T6, T7, T8, T9]>
export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>, arbitrary10: ArbitraryCore<T10>): Checker<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10]>
export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>, arbitrary10: ArbitraryCore<T10>, arbitrary11: ArbitraryCore<T11>): Checker<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11]>
export function tuple<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12>(arbitrary1: ArbitraryCore<T1>, arbitrary2: ArbitraryCore<T2>, arbitrary3: ArbitraryCore<T3>, arbitrary4: ArbitraryCore<T4>, arbitrary5: ArbitraryCore<T5>, arbitrary6: ArbitraryCore<T6>, arbitrary7: ArbitraryCore<T7>, arbitrary8: ArbitraryCore<T8>, arbitrary9: ArbitraryCore<T9>, arbitrary10: ArbitraryCore<T10>, arbitrary11: ArbitraryCore<T11>, arbitrary12: ArbitraryCore<T12>): Checker<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12]>
export function tuple<T>(arbitrary: ArbitraryCore<T>, ...arbitraries: ArbitraryCore<T>[]): Checker<T[]>
export function tuple<T>(arbitrary: ArbitraryCore<T>, ...arbitraries: ArbitraryCore<T>[]): Checker<T[]> {
    return fromArbitrary(Arbitrary.tuple(arbitrary, ...arbitraries))
}

// ```F#
// for i in 2..8 do
// let f sep f = {1..i} |> Seq.map f |> String.concat sep
// let g = f >> (>>) sprintf
// let t = g " | " "T%d"
// printfn "export function sum<%s>(%s): Checker<%s>"
//     (g ", " "T%d")
//     (f ", " <| fun n -> sprintf "arbitrary%d: [Arbitrary<T%d>, Is<%s, T%d>]" n n t n)
//     t
// ```
export function sum<T1, T2>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2, T2>]): Checker<T1 | T2>
export function sum<T1, T2, T3>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3, T3>]): Checker<T1 | T2 | T3>
export function sum<T1, T2, T3, T4>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4, T4>]): Checker<T1 | T2 | T3 | T4>
export function sum<T1, T2, T3, T4, T5>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 |
    T5, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5, T5>]): Checker<T1 | T2 | T3 | T4 | T5>
export function sum<T1, T2, T3, T4, T5, T6>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5 | T6, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 | T5 | T6, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5 | T6, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5 | T6, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5 | T6, T5>], arbitrary6: [ArbitraryCore<T6>, Is<T1 | T2 | T3 | T4 | T5 | T6, T6>]): Checker<T1 | T2 | T3 | T4 | T5 | T6>
export function sum<T1, T2, T3, T4, T5, T6, T7>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T5>], arbitrary6: [ArbitraryCore<T6>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T6>], arbitrary7: [ArbitraryCore<T7>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7, T7>]): Checker<T1 | T2 | T3 | T4 | T5 | T6 | T7>
export function sum<T1, T2, T3, T4, T5, T6, T7, T8>(arbitrary1: [ArbitraryCore<T1>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T1>], arbitrary2: [ArbitraryCore<T2>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T2>], arbitrary3: [ArbitraryCore<T3>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T3>], arbitrary4: [ArbitraryCore<T4>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T4>], arbitrary5: [ArbitraryCore<T5>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T5>], arbitrary6: [ArbitraryCore<T6>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T6>], arbitrary7: [ArbitraryCore<T7>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T7>], arbitrary8: [ArbitraryCore<T8>, Is<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8, T8>]): Checker<T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8>
export function sum<T>(arbitrary: [ArbitraryCore<T>, Is<T, T>], ...arbitraries: [ArbitraryCore<T>, Is<T, T>][]): Checker<T>
export function sum<T>(arbitrary: [ArbitraryCore<T>, Is<T, T>], ...arbitraries: [ArbitraryCore<T>, Is<T, T>][]) {
    return fromArbitrary(Arbitrary.sum(arbitrary, ...arbitraries))
}

export interface ForwardDeclarationChecker<T> extends Checker<T> {
    definition: Checker<T>
}

function throwNotInitialized(): never {
    throw new Error("definition not assigned")
}
class ForwardDeclarationCheckerImpl<T> implements ForwardDeclarationChecker<T> {
    get definition(): Checker<T> { return this }
    set definition(x: Checker<T>) { Object.setPrototypeOf(this, x) }
    
    check() { return throwNotInitialized() }
    
    array() { return throwNotInitialized() }
    readonlyArray() { return throwNotInitialized() }

    sample() { return throwNotInitialized() }
    map<U extends T>(convertTo: (value: T) => U, convertFrom?: ((value: U) => T)): Checker<U>;
    map<U>(convertTo: (value: T) => U, convertFrom: (value: U) => T): Checker<U>;
    map() { return throwNotInitialized() }
    filter() { return throwNotInitialized() }
    nullable<A extends {} | undefined>(this: ForwardDeclarationChecker<A>): Checker<Nullable<A>> { return throwNotInitialized() }
    optional<A extends {} | null>(this: ForwardDeclarationChecker<A>): Checker<Optional<A>> { return throwNotInitialized() }
    generate() { return throwNotInitialized() }
    shrink() { return throwNotInitialized() }
    stringify() { return throwNotInitialized() }
}

export function forwardDeclaration<T>(): ForwardDeclarationChecker<T> {
    return new ForwardDeclarationCheckerImpl<T>()
}
