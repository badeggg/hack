import ExpensiMark from 'expensify-common/lib/ExpensiMark';

const parser = new ExpensiMark();
const html = parser.replace(markdown, {
    shouldKeepRawInput: true,
});

return html as string;
