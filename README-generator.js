// spell-checker: ignore escodegen estree
//@ts-check
const prettier = require("prettier")
const esprima = require("esprima")
const escodegen = require("escodegen")
const package = require("./package.json")
const packageName = package.name
const { assert } = require("chai")
const { writeFile } = require("fs/promises")

const error = (/** @type {TemplateStringsArray} */ message, /** @type {unknown[]} */ ...args) => { throw new Error(String.raw(message, ...args)) }
/**
 * @param {() => void} testFunction
 * @returns {string}
 */
const testCode = testFunction => {
    testFunction()

    const { Syntax } = esprima

    const program = esprima.parseScript(testFunction.toString(), {
        comment: true
    })
    const expression = program.body[0] ?? error`At least one expression is required.`
    if (expression.type !== Syntax.ExpressionStatement) { return error`${Syntax.ExpressionStatement} is required.` }

    const { expression: functionExpression } = expression
    if (functionExpression.type !== Syntax.ArrowFunctionExpression && functionExpression.type !== Syntax.FunctionExpression) { return error`${Syntax.FunctionExpression} is required.` }

    const { body: functionBody } = functionExpression
    /** @type {import("estree").Statement[]} */
    let statements
    switch (functionBody.type) {
        case "BlockStatement": statements = functionBody.body; break
        default: statements = [{ type: "ExpressionStatement", expression: functionBody }]; break
    }
    /** @type {esprima.Program} */
    const programOfFunctionBody = { type: "Program", body: statements, sourceType: "script" }
    const code = escodegen.generate(programOfFunctionBody, {
        comment: true,
    })
    return prettier
        .format(code, { parser: "babel" })
        // TODO:
        .replace("./lib/qcheck", "qcheck")
}
const contents = `# ${packageName}

${packageName} is a library to support testing by generating random test cases.

## Installation

\`\`\`sh
npm install --save-dev ${packageName}
\`\`\`

## Usage

\`\`\`js
${testCode(() => {
    const q = require("./lib/qcheck")

    q
        .interface_({ name: q.string, age: q.number })
        .check(person => {
            assert.typeOf(person, "object")
            assert.typeOf(person.age, "number")
            assert.typeOf(person.name, "string")
        })
})}
\`\`\`
`

writeFile("./README.md", contents)
