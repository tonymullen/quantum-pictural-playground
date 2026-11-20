/**
 * The bibliography: one entry per work the textbook cites, by key.
 *
 * In the text a citation is  <a class="cite" data-key="nc2010" data-loc="§2.1.7"></a>
 * and renders as [Nielsen & Chuang 2010, §2.1.7], linked to references.html.
 *
 * Every entry and every location cited from it is checked against the work
 * itself (or the publisher's record) before it goes in; `checked` says what
 * was checked against. Nothing is cited from memory.
 */
export const BIB = {
  pqp: {
    short: 'PQP',
    authors: 'Bob Coecke and Aleks Kissinger',
    title: 'Picturing Quantum Processes: A First Course in Quantum Theory and Diagrammatic Reasoning',
    publisher: 'Cambridge University Press', year: 2017,
    isbn: '978-1-107-10422-8', doi: '10.1017/9781316219317',
    url: 'https://www.cs.ox.ac.uk/people/aleks.kissinger/PQP.pdf',
    note: 'Cited from the authors’ freely available PDF (the version dated 14 October 2020), by section, '
      + 'equation and result number; page numbers, where given, are the PDF’s printed page numbers.',
    checked: 'The PDF (sections, numbered results and equations); the publisher’s record (cambridge.org/9781108110440).',
  },
  nc2010: {
    short: 'Nielsen & Chuang 2010',
    authors: 'Michael A. Nielsen and Isaac L. Chuang',
    title: 'Quantum Computation and Quantum Information: 10th Anniversary Edition',
    publisher: 'Cambridge University Press', year: 2010,
    isbn: '978-1-107-00217-3',
    note: 'Cited by section and figure number (10th Anniversary Edition).',
    checked: 'The publisher’s front matter (contents, section numbers); the text of §2.1 and Figure 2.1.',
  },
  dirac1939: {
    short: 'Dirac 1939',
    authors: 'P. A. M. Dirac',
    title: 'A new notation for quantum mechanics',
    journal: 'Mathematical Proceedings of the Cambridge Philosophical Society', volume: '35', issue: '3', pages: '416–418',
    year: 1939, doi: '10.1017/S0305004100021162',
    note: 'The paper that introduced the names “bra” and “ket”.',
    checked: 'The publisher’s record (Cambridge Core) and NASA ADS (1939PCPS...35..416D).',
  },
};

/** The full reference as HTML-safe text parts. */
export function formatEntry(e) {
  const parts = [`${e.authors}.`, e.journal ? `“${e.title}.”` : `<em>${e.title}</em>.`];
  if (e.journal) parts.push(`<em>${e.journal}</em> ${e.volume}${e.issue ? `(${e.issue})` : ''}, ${e.pages}, ${e.year}.`);
  else parts.push(`${e.publisher}, ${e.year}.`);
  if (e.isbn) parts.push(`ISBN ${e.isbn}.`);
  if (e.doi) parts.push(`doi:<a href="https://doi.org/${e.doi}">${e.doi}</a>.`);
  if (e.url) parts.push(`<a href="${e.url}">${e.url}</a>`);
  return parts.join(' ');
}
