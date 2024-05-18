import ExpensiMark from "expensify-common/lib/ExpensiMark";

const m1 = `
>>> hello
>> hi
> i
`;

const m2 = `# ddd`;

const m3 = `   # ddd`;

const m4 = `
>>>  # hello
>> hi
> i
`;

const eff = m1;

console.log('================');
console.log(eff);

const parser = new ExpensiMark();
const html = parser.replace(eff, {
  shouldKeepRawInput: false,
});

console.log('================');
console.log(html);
