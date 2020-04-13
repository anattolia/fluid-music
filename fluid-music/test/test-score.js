const should = require('should');
const mocha = require('mocha');
const score = require('../src/score');

describe('score', () => {
  describe('score.buildTracks', () => {
    const noteLibrary = [0, 1, 2, 3, 4, 5, 6];

    const r =  '1234'
    const p1 = '.0..'
    const clip1 = [{ n: 0, s: 0.25, l: 0.25 }];
    clip1.startTime = 0;
    clip1.duration = 1;

    const p2 = '01..';
    const clip2 = [{ n: 0, s: 0, l: 0.25 }, { n:1, s: 0.25, l: 0.25 }];
    clip2.duration = 1;


    it('should parse a very simple object', () => {
      const obj = { noteLibrary, r, p1 }

      score.buildTracks(obj).should.containDeep({
        p1: {
          clips: [clip1],
        },
      });
    });

    it('should treat a pattern array with .length=1 the same as a single string', () => {
      const s1 = { noteLibrary, r, p1: [p1]};
      const s2 = { noteLibrary, r, p1: p1 };

      const result1 = score.buildTracks(s1);
      const result2 = score.buildTracks(s2);
      result1.should.containDeep({
        p1: { clips: [ clip1 ]}
      });

      delete result1.p1.originalValue;
      delete result2.p1.originalValue;

      result1.should.deepEqual(result2);
    });

    it('should handle arrays', () => {
      const s1 = { noteLibrary, r, drums: [
        '.0..',
        '.1..',
      ]};
      const result1 = score.buildTracks(s1);

      const clip1 = [{n: 0, s: 0.25, l: 0.25}];
      clip1.startTime = 0;
      clip1.duration  = 1;

      const clip2 = [{n: 1, s: 0.25, l: 0.25}];
      clip2.startTime = 1;
      clip2.duration  = 1;

      result1.should.containDeep({
        drums: {
          clips: [ clip1, clip2 ],
        }
      });
    });

    it('should handle nested arrays', () => {
      const s1 = { noteLibrary, r, drums: [
        ['0...', '1...'],
        '2...', '3...'
      ]};
      const clip0 = [{n: 0, s: 0, l: 0.25}]; clip0.startTime = 0;
      const clip1 = [{n: 1, s: 0, l: 0.25}]; clip1.startTime = 1;
      const clip2 = [{n: 2, s: 0, l: 0.25}]; clip2.startTime = 2;
      const clip3 = [{n: 3, s: 0, l: 0.25}]; clip3.startTime = 3;

      const result1 = score.buildTracks(s1);
      result1.should.containDeep({
        drums: {
          clips: [ clip0, clip1, clip2, clip3 ],
        }
      });
    });

    it('should handle arrays that contain objects', () => {
      const s1 = { noteLibrary, r, drums: [
        '1...',
        { k: '0.1.' },
        ['2...', '3...']
      ]};

      const clip0 = [{n: 1, s: 0, l: 0.25}]; clip0.startTime = 0;
      const clip1 = [{n: 0, s: 0, l: 0.25}, { n:1, s: 0.5, l: 0.25 }]; clip1.startTime = 1;
      const clip2 = [{n: 2, s: 0, l: 0.25}]; clip2.startTime = 2;
      const clip3 = [{n: 3, s: 0, l: 0.25}]; clip3.startTime = 3;

      const result1 = score.buildTracks(s1);
      result1.should.containDeep({
        drums: {
          clips: [ clip0, clip2, clip3 ],
        },
        k: {
          clips: [ clip1 ]
        },
      });
    });

    it('should handle objects inside arrays', () => {
      const s1 = { noteLibrary, r, main: [
        '0...',
        { drum: '1...'},
        { drum: '2...'},
        '3...'
      ]};

      // expected
      const clip0 = [{n: 0, s: 0, l: 0.25}]; clip0.startTime = 0;
      const clip1 = [{n: 1, s: 0, l: 0.25}]; clip1.startTime = 1;
      const clip2 = [{n: 2, s: 0, l: 0.25}]; clip2.startTime = 2;
      const clip3 = [{n: 3, s: 0, l: 0.25}]; clip3.startTime = 3;
      const expectedResult = {
        main: {
          clips: [clip0, clip3],
        },
        drum: {
          clips: [clip1, clip2],
        },
      };

      const result1 = score.buildTracks(s1);
      result1.should.containDeep(expectedResult);
    });

    it('should handle deeply nested objects', () => {
      const s1 = { noteLibrary, r, main: [
        {
          drums: '0...',
          other: {
            r: '12341234',
            p: '1'
          },
          d2: '2'
        },
        { drums: '3...'},
        '4...'
      ]};
      const clip0 = [{n: 0, s: 0, l: 0.25}]; clip0.startTime = 0; clip0.duration = 1;
      const clip1 = [{n: 1, s: 0, l: 0.25}]; clip1.startTime = 0; clip1.duration = 2;
      const clip2 = [{n: 2, s: 0, l: 0.25}]; clip2.startTime = 0; clip2.duration = 1;
      const clip3 = [{n: 3, s: 0, l: 0.25}]; clip3.startTime = 2; clip3.duration = 1;
      const clip4 = [{n: 4, s: 0, l: 0.25}]; clip4.startTime = 3; clip4.duration = 1;

      const expectedResult = {
        main: {
          clips: [clip4],
        },
        drums: {
          clips: [clip0, clip3],
        },
        p: {
          clips: [clip1]
        },
        d2: {
          clips: [clip2]
        },
      };

      const result1 = score.buildTracks(s1);
      result1.should.containDeep(expectedResult);
    });
  }); // describe score.buildTracks
}); // describe score