import "mocha"
import { assert } from "chai"
import { Random, int32, Runner, Config, string, interface_ as object, Arbitrary, codePoint, tuple } from "../src/qcheck"
import { String, CodePoint, Iterable, Int32 } from "wiinuk-extensions"
import { pure, sum } from "../src/qcheck"

describe("Random", () => {
    it("nextUInt32", () => {
        const r = new Random(88675123)
        const actual = []
        for (let i = 0; i < 20; i++) {
            actual.push(r.nextUInt32())
        }
        const expected = [
            3701687786,
            458299110,
            2500872618,
            3633119408,
            516391518,
            2377269574,
            2599949379,
            717229868,
            137866584,
            395339113,
            1301295572,
            1728310821,
            3538670320,
            1187274473,
            2316753268,
            4061953237,
            2129415220,
            448488982,
            643481932,
            934407046,
        ]
        assert.deepEqual(actual, expected)
    })
})

describe("runner", () => {
    let buffer: string[] = []
    const bufferedRunner = Runner.fromFunction(m => buffer.push(m))
    const bufferedConfig = { ...Config.defaultValue, runner: bufferedRunner }

    it("int32", () => {
        const expected = `0: 0
1: 0
2: 2
3: 1
4: 0
5: 4
6: 6
7: 5
8: 2
9: 0
10: -7
11: 0
12: -11
13: -4
14: 2
15: -14
16: -15
17: 7
18: -11
19: 18
shrink[0]: 18 => 17
shrink[1]: 18 => 9
shrink[1]: 17 => 16
shrink[2]: 17 => 8
shrink[2]: 16 => 15
shrink[3]: 16 => 8
shrink[3]: 15 => 14
shrink[4]: 15 => 7
shrink[4]: 14 => 13
shrink[5]: 14 => 7
shrink[5]: 13 => 12
shrink[6]: 13 => 6
shrink[6]: 12 => 11
shrink[7]: 12 => 6
shrink[7]: 11 => 10
Falsifiable, after 20 tests (7 shrink) (seed: 1873066016):
Original: 18
Shrunk: 11`

        buffer = []
        int32.check(x => { if (10 < x) { throw new Error("err") } }, { ...bufferedConfig, seed: 1873066016 })
        assert.deepEqual(buffer, expected.split(/\r?\n/))
    })
    it("default runner is throwOnFailure", () => {
        assert.throws(() => {
            string.check(() => { throw new Error("err") })
        })
    })
})

function assertIsInt32(x: any) {
    assert.isNumber(x)
    assert.deepEqual(x, x | 0, "isInteger")
    assert.isAtLeast(x, Int32.Min, "Int32.Min <= x")
    assert.isAtMost(x, Int32.Max, "x <= Int32.Max")
}

function assertIsCodePoint(x: any) {
    assert.isNumber(x)
    assert.deepEqual(x, x | 0, "isInteger")
    assert.isAtLeast(x, CodePoint.Min, `CodePoint.Min <= x /* ${x} */`)
    assert.isAtMost(x, CodePoint.Max, `x /* ${x} */ <= CodePoint.Max`)
}

namespace Array {
    export function zip<T1, T2>(xs1: T1[], xs2: T2[]) {
        const xs: [T1, T2][] = []
        const size = Math.min(xs1.length, xs2.length)
        for (let i = 0; i < size; i++) {
            xs[i] = [xs1[i], xs2[i]]
        }
        return xs
    }
}

function ltInt32(l: Int32, r: Int32) {
    return Math.abs(l) < Math.abs(r)
}

function ltCodePoint(l: CodePoint, r: CodePoint) {
    const lc = Arbitrary.CodePoint.category(l)
    const rc = Arbitrary.CodePoint.category(r)
    return lc < rc || (lc === rc && (l < r))
}
function ltString(l: string, r: string) {
    return (l.length < r.length) ||
        (l.length === r.length &&
            Array.zip(String.codePoints(l), String.codePoints(r))
                .some(([act, exp]) => ltCodePoint(act, exp))
        )
}

describe("checker", () => {
    it("CodePoint", () => {
        for (const x of codePoint.sample({ count: 100, delta: 1 })) {
            assertIsCodePoint(x)

            for (const x2 of codePoint.shrink(x)) {
                assertIsCodePoint(x2)

                assert.isTrue(ltCodePoint(x2, x), `x2 /* ${x2} */ < x /* ${x} */`)
            }
        }
    })
    it("{ x: int32, y: string }", () => {
        const type = object({
            x: int32,
            y: string
        })
        for (const x of type.sample({ count: 20, delta: 5 })) {
            assert.property(x, "x")
            assert.property(x, "y")

            assertIsInt32(x.x)
            assert.isString(x.y)

            for (const x2 of Iterable.truncate(type.shrink(x), 10)) {
                assert.property(x2, "x")
                assert.property(x2, "y")

                assertIsInt32(x2.x)
                assert.isString(x2.y)

                assert.isTrue(
                    ltInt32(x2.x, x.x) ||
                    ltString(x2.y, x.y),
                    `x2.x /* ${x2.x} */ < x.x /* ${x.x} */ || x2.y /* "${x2.y}" */ < x.y /* "${x.y}" */`
                )
            }
        }
    })
    it(`"a" | 42`, () => {
        const toArray = global.Array.from
        const checker = sum(pure("a"), pure(42))
        assert.deepEqual(
            toArray(checker.shrink("a")),
            []
        )
        assert.deepEqual(
            toArray(checker.shrink(42)),
            []
        )
        checker
            .sample({ count: 100 })
            .forEach(x => assert.deepOwnInclude(["a", 42], x))
    })
    it("[int32, string]", () => {
        const checker = tuple(int32, string)
        for (const x of checker.sample({ count: 20, delta: 5 })) {
            assert.equal(x.length, 2)

            assertIsInt32(x[0])
            assert.isString(x[1])

            for (const x2 of Iterable.truncate(checker.shrink(x), 10)) {
                assert.equal(x2.length, 2)

                assertIsInt32(x2[0])
                assert.isString(x2[1])

                assert.isTrue(
                    ltInt32(x2[0], x[0]) ||
                    ltString(x2[1], x[1]),
                    `x2.x /* ${x2[0]} */ < x.x /* ${x[0]} */ || x2.y /* "${x2[1]}" */ < x.y /* "${x[1]}" */`
                )
            }
        }
    })
})
