import ExpensiMark from "expensify-common/lib/ExpensiMark";

const m1 = `
>>> hello
>> hi
> i
`;

const m2 = `# ddd`;

const m3 = `   # ddd`;

const m4 = `
>>> # hello
>> hi
> i
`;

const parser = new ExpensiMark();
const html = parser.replace(m1, {
  shouldKeepRawInput: true,
});

console.log(html);
