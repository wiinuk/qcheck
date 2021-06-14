// spell-checker: ignore arbitraries
import { mixed, Nullable, Optional, primitive, Int32, CodePoint } from "wiinuk-extensions"
import { seedOfNow, Random } from "./random"
import { Arbitrary, SampleOptions, ArrayArbitraryOptions, DiscriminatedArbitrary, Discriminator } from "./arbitrary"

export * from "./random"
export * from "./arbitrary"


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
    const printOnFinish = <T>(result: TestResult<T>, log: (line: string) => void) => {
        if (result.type === "Success") { return log(`Ok passed ${result.testCount} tests.`) }

        const { show, testCount, shrinkCount, seed, originalFail, minFail } = result
        log(`Falsifiable, after ${testCount} tests (${shrinkCount} shrink) (seed: ${seed}):`)
        log(`Original: ${show.stringify(originalFail)}`)
        log(`Shrunk: ${show.stringify(minFail)}`)

        if (result.type === "Exception") {
            log(`with exception: ${result.error}`)
        }
    }
    export function fromFunction(log: (message: string) => void): Runner {
        return {
            onShrink(shrinkCount, maxValue, value) {
                log(`shrink[${shrinkCount}]: ${maxValue} => ${value}`)
            },
            onTest(testCount, currentValue) {
                log(`${testCount}: ${currentValue}`)
            },
            onFinish(result) {
                printOnFinish(result, log)
            }
        }
    }
    export const console = fromFunction(global.console.log)
    export const throwOnFailure: Runner = {
        onShrink() {},
        onTest() {},
        onFinish(result) {
            if (result.type === "Success") { return }

            throw new (class TestFailureError extends Error {
                constructor() {
                    let message = ""
                    printOnFinish(result, line => message += line + "\n")
                    super(message)
                }
                get testResult() { return result }
            })()


        }
    }
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
    readonly arb: Arbitrary<T>
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

function check<T>(arb: Arbitrary<T>, show: Show<T>, test: (value: T) => any, { seed = seedOfNow(), maxTest, startSize, endSize, runner = Runner.throwOnFailure } = Config.defaultValue) {
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
    sample(options?: SampleOptions): T[]

    check(test: (value: T) => any, config?: Config): TestResult<T>
    array(options: { readonly min: 1 }): Checker<[T, ...T[]]>
    array(options: { readonly min: 2 }): Checker<[T, T, ...T[]]>
    array(options?: { readonly min?: number }): Checker<T[]>

    readonlyArray(options: { readonly min: 1 }): Checker<readonly [T, ...T[]]>
    readonlyArray(options: { readonly min: 2 }): Checker<readonly [T, T, ...T[]]>
    readonlyArray(options?: { readonly min?: number }): Checker<readonly T[]>

    map<U extends T>(convertTo: (value: T) => U): Checker<U>
    map<U>(convertTo: (value: T) => U, convertFrom: (value: U) => T): Checker<U>
    filter(predicate: (value: T) => boolean): Checker<T>

    nullable<A extends {} | undefined>(this: Checker<A>): Checker<Nullable<A>>
    optional<A extends {} | null>(this: Checker<A>): Checker<Optional<A>>

    withPrinter(stringify: (value: T) => string): Checker<T>
}
export interface DiscriminatedChecker<TOverall, T extends TOverall> extends Checker<T>, Discriminator<TOverall, T> {}

class FromArbitrary<T, TArbitrary extends Arbitrary<T>> implements Checker<T> {
    constructor(
        private readonly _arbitrary: TArbitrary,
        private readonly _stringify: (value: T) => string = Show.any.stringify,
    ) {}

    sample(options?: SampleOptions) { return Arbitrary.sample(this._arbitrary, options) }
    generate(random: Random, size: Int32) { return this._arbitrary.generate(random, size) }
    shrink(value: T): Iterable<T> { return this._arbitrary.shrink(value) }

    check(this: Checker<T>, test: (value: T) => any, config?: Config): TestResult<T> { return check(this, this, test, config) }

    array(options: { readonly min: 1 }): Checker<[T, ...T[]]>
    array(options: { readonly min: 2 }): Checker<[T, T, ...T[]]>
    array(options?: { readonly min?: number }): Checker<T[]>
    array(options?: { readonly min?: number }): Checker<T[]> { return array(this, options) }

    readonlyArray(options: { readonly min: 1 }): Checker<readonly [T, ...T[]]>
    readonlyArray(options: { readonly min: 2 }): Checker<readonly [T, T, ...T[]]>
    readonlyArray(options?: { readonly min?: number }): Checker<readonly T[]>
    readonlyArray(options?: { readonly min?: number }): Checker<readonly T[]> { return array(this, options) as Checker<readonly T[]> }

    map<U extends T>(convertTo: (value: T) => U): Checker<U>
    map<U>(convertTo: (value: T) => U, convertFrom: (value: U) => T): Checker<U>
    map<U extends T>(convertTo: (value: T) => U, convertFrom: (value: U) => T = x => x): Checker<U> { return fromArbitrary(Arbitrary.map(this, convertTo, convertFrom)) }
    filter(predicate: (value: T) => boolean): Checker<T> { return fromArbitrary(Arbitrary.filter(this, predicate)) }

    nullable<A extends {} | undefined>(this: Arbitrary<A>): Checker<Nullable<A>> { return fromArbitrary(Arbitrary.nullable(this)) }
    optional<A extends {} | null>(this: Arbitrary<A>): Checker<Optional<A>> { return fromArbitrary(Arbitrary.optional(this)) }

    stringify(value: T): string { return this._stringify(value) }
    withPrinter(stringify: (value: T) => string) { return new FromArbitrary(this._arbitrary, stringify) }

    is<TOverall, U extends TOverall>(this: FromArbitrary<U, DiscriminatedArbitrary<TOverall, U>>, value: TOverall): value is U {
        return this._arbitrary.is(value)
    }
}

export function fromArbitrary<TOverall, T extends TOverall>(arbitrary: DiscriminatedArbitrary<TOverall, T>): DiscriminatedChecker<TOverall, T>
export function fromArbitrary<T>(arbitrary: Arbitrary<T>): Checker<T>
export function fromArbitrary<T>(arbitrary: Arbitrary<T>): Checker<T> {
    return new FromArbitrary(arbitrary)
}

export function pure<T extends null | undefined | string | number | boolean>(value: T): DiscriminatedChecker<unknown, T>
export function pure<T>(value: T): Checker<T>
export function pure<T>(value: T) { return fromArbitrary(Arbitrary.pure(value)) }

export function elements<T extends primitive>(value: T, ...values: T[]) { return fromArbitrary(Arbitrary.elements([value, ...values])) }

export const number = fromArbitrary(Arbitrary.number)
export const int32: Checker<Int32> = fromArbitrary(Arbitrary.int32)
export const codePoint: Checker<CodePoint> = fromArbitrary(Arbitrary.codePoint)


export function array<T>(arbitrary: Arbitrary<T>, options: ArrayArbitraryOptions<1>): Checker<[T, ...T[]]>
export function array<T>(arbitrary: Arbitrary<T>, options: ArrayArbitraryOptions<2>): Checker<[T, T, ...T[]]>
export function array<T>(arbitrary: Arbitrary<T>, options?: Partial<ArrayArbitraryOptions<number>>): Checker<T[]>
export function array<T>(arbitrary: Arbitrary<T>, options?: Partial<ArrayArbitraryOptions<number>>) { return fromArbitrary(Arbitrary.array(arbitrary, options)) }

export const string = fromArbitrary(Arbitrary.string)
export function interface_<T>(arbitraryMap: {[P in keyof T]: Arbitrary<T[P]> }) { return fromArbitrary(Arbitrary.interface_<T>(arbitraryMap)) }

export function tuple<TArbs extends Arbitrary<any>[]>(...arbitraries: TArbs): Checker<{ [k in keyof TArbs]: TArbs[k] extends Arbitrary<infer t> ? t : never }> {
    return fromArbitrary(Arbitrary.tuple(arbitraries))
}

export function sum<TArbs extends [DiscriminatedArbitrary<any, any>, ...DiscriminatedArbitrary<any, any>[]]>(...arbitraries: TArbs): Checker<{ [k in keyof TArbs]: TArbs[k] extends DiscriminatedArbitrary<any, infer t> ? t : never }[number]> {
    return fromArbitrary(Arbitrary.sum(arbitraries))
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

    array1() { return throwNotInitialized() }
    array2() { return throwNotInitialized() }
    array() { return throwNotInitialized() }

    readonlyArray1() { return throwNotInitialized() }
    readonlyArray2() { return throwNotInitialized() }
    readonlyArray() { return throwNotInitialized() }

    sample() { return throwNotInitialized() }
    mapExtend<U extends T>(): Checker<U> { return throwNotInitialized() }
    map<U>(): Checker<U> { return throwNotInitialized() }
    filter() { return throwNotInitialized() }
    nullable<A extends {} | undefined>(this: ForwardDeclarationChecker<A>): Checker<Nullable<A>> { return throwNotInitialized() }
    optional<A extends {} | null>(this: ForwardDeclarationChecker<A>): Checker<Optional<A>> { return throwNotInitialized() }
    generate() { return throwNotInitialized() }
    shrink() { return throwNotInitialized() }
    stringify() { return throwNotInitialized() }
    withPrinter() { return throwNotInitialized() }
}

export function forwardDeclaration<T>(): ForwardDeclarationChecker<T> {
    return new ForwardDeclarationCheckerImpl<T>()
}
