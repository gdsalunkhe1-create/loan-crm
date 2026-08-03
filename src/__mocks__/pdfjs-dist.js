// Manual Jest mock for pdfjs-dist, used by src/utils/__tests__/bankBehaviour.test.js.
// Lets tests drive analyzeBankStatement() with synthetic page content instead
// of a real PDF file/binary - see src/utils/__tests__/README.md.
let currentPages = [];

export function __setMockPages(pages) {
  currentPages = pages;
}

export const GlobalWorkerOptions = {};

export function getDocument() {
  const pages = currentPages;
  return {
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: (p) => Promise.resolve({
        getTextContent: () => Promise.resolve({
          items: pages[p - 1].map(({ y, x = 0, str }) => ({ str, transform: [1, 0, 0, 1, x, y] })),
        }),
      }),
    }),
  };
}
