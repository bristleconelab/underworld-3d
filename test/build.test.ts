import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script without types
import { splitCsv } from '../scripts/build_quakes.mjs';

describe('build_quakes.mjs', () => {
  it('splits USGS CSV lines with quoted places', () => {
    expect(splitCsv('2024-01-01T00:00:00.000Z,-20.5,-175.2,300.1,6.1,mww,,,,,us,us7000abcd,2024,"100 km NE of Neiafu, Tonga",earthquake,8.1,1.9'))
      .toEqual(['2024-01-01T00:00:00.000Z', '-20.5', '-175.2', '300.1', '6.1', 'mww', '', '', '', '', 'us', 'us7000abcd', '2024', '100 km NE of Neiafu, Tonga', 'earthquake', '8.1', '1.9']);
    expect(splitCsv('a,"say ""hi""",c')).toEqual(['a', 'say "hi"', 'c']);
  });
});
