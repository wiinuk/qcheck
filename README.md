# qcheck

qcheck is a library to support testing by generating random test cases.

## Installation

```sh
npm install --save-dev qcheck
```

## Usage

```js
const q = require("qcheck");
q.interface_({
  name: q.string,
  age: q.number,
}).check((person) => {
  assert.typeOf(person, "object");
  assert.typeOf(person.age, "number");
  assert.typeOf(person.name, "string");
});

```
