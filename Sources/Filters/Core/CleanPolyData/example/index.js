import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkCleanPolyData from 'vtk.js/Sources/Filters/Core/CleanPolyData';

// ----------------------------------------------------------------------------
// 1) Build the three test datasets (lines, polys, strips)
// ----------------------------------------------------------------------------

function makeLines() {
  const pts = vtkPoints.newInstance();
  pts.insertNextTuple([0, 0, 0]);
  pts.insertNextTuple([1, 0, 0]);
  pts.insertNextTuple([1, 1, 0]);
  pts.insertNextTuple([0, 0, 0]); // repeated

  const lines = vtkCellArray.newInstance();
  lines.insertNextCell([0, 1]); // normal line
  lines.insertNextCell([0, 0]); // degenerate → vertex
  lines.insertNextCell([0, 3]); // repeated pts → vertex if merging
  lines.insertNextCell([0, 1, 2]); // polyline
  lines.insertNextCell([0, 1, 1]); // degenerate → line
  lines.insertNextCell([0, 3, 0]); // cycle → vertex if merging

  const pd = vtkPolyData.newInstance();
  pd.setPoints(pts);
  pd.setLines(lines);
  return pd;
}

function makePolys() {
  const pts = vtkPoints.newInstance();
  pts.insertNextTuple([0, 0, 0]);
  pts.insertNextTuple([1, 0, 0]);
  pts.insertNextTuple([1, 1, 0]);
  pts.insertNextTuple([1, 1, 1]); // unused
  pts.insertNextTuple([0, 0, 0]); // repeated
  pts.insertNextTuple([1, 0, 0]); // repeated

  const polys = vtkCellArray.newInstance();
  polys.insertNextCell([0, 1, 2]); // normal tri
  polys.insertNextCell([0, 0, 0]); // degenerate → vertex
  polys.insertNextCell([0, 1, 1]); // degenerate → line
  polys.insertNextCell([0, 1, 5]); // repeated id → line if merging
  polys.insertNextCell([0, 4, 0]); // vertex if merging
  polys.insertNextCell([1, 1, 1, 1]); // quad→vertex
  polys.insertNextCell([0, 1, 1, 0]); // quad→line

  const pd = vtkPolyData.newInstance();
  pd.setPoints(pts);
  pd.setPolys(polys);
  return pd;
}

function makeStrips() {
  const pts = vtkPoints.newInstance();
  pts.insertNextTuple([0, 0, 0]);
  pts.insertNextTuple([1, 0, 0]);
  pts.insertNextTuple([1, 1, 0]);
  pts.insertNextTuple([0, 1, 0]);
  pts.insertNextTuple([1, 1, 1]); // unused
  pts.insertNextTuple([0, 0, 0]); // repeated
  pts.insertNextTuple([1, 0, 0]); // repeated
  pts.insertNextTuple([1, 1, 0]); // repeated

  const strips = vtkCellArray.newInstance();
  strips.insertNextCell([0, 1, 2, 3]); // normal strip
  strips.insertNextCell([0, 1, 2, 2]); // tri if no merging
  strips.insertNextCell([0, 1, 2, 7]); // repeated→tri if merging
  strips.insertNextCell([0, 1, 1, 1]); // line
  strips.insertNextCell([0, 0, 6, 5]); // line or tri
  strips.insertNextCell([2, 2, 2, 2]); // vertex
  strips.insertNextCell([0, 0, 0, 5]); // vertex or line

  const pd = vtkPolyData.newInstance();
  pd.setPoints(pts);
  pd.setStrips(strips);
  return pd;
}

// ----------------------------------------------------------------------------
// 2) Define the four test configurations & their expected counts
// ----------------------------------------------------------------------------

const TESTS = [
  {
    name: 'Conversions without merging',
    config: {
      pointMerging: false,
      convertLinesToPoints: true,
      convertPolysToLines: true,
      convertStripsToPolys: true,
    },
    inputs: [
      {
        pd: makeLines(),
        expect: { points: 4, verts: 1, lines: 5, polys: 0, strips: 0 },
      },
      {
        pd: makePolys(),
        expect: { points: 5, verts: 2, lines: 3, polys: 2, strips: 0 },
      },
      {
        pd: makeStrips(),
        expect: { points: 7, verts: 1, lines: 2, polys: 2, strips: 2 },
      },
    ],
  },
  {
    name: 'Elimination without merging',
    config: {
      pointMerging: false,
      convertLinesToPoints: false,
      convertPolysToLines: false,
      convertStripsToPolys: false,
    },
    inputs: [
      {
        pd: makeLines(),
        expect: { points: 4, verts: 0, lines: 5, polys: 0, strips: 0 },
      },
      {
        pd: makePolys(),
        expect: { points: 5, verts: 0, lines: 0, polys: 2, strips: 0 },
      },
      {
        pd: makeStrips(),
        expect: { points: 7, verts: 0, lines: 0, polys: 0, strips: 2 },
      },
    ],
  },
  {
    name: 'Conversions with merging',
    config: {
      pointMerging: true,
      convertLinesToPoints: true,
      convertPolysToLines: true,
      convertStripsToPolys: true,
    },
    inputs: [
      {
        pd: makeLines(),
        expect: { points: 3, verts: 3, lines: 3, polys: 0, strips: 0 },
      },
      {
        pd: makePolys(),
        expect: { points: 3, verts: 3, lines: 3, polys: 1, strips: 0 },
      },
      {
        pd: makeStrips(),
        expect: { points: 4, verts: 2, lines: 2, polys: 2, strips: 1 },
      },
    ],
  },
  {
    name: 'Elimination with merging',
    config: {
      pointMerging: true,
      convertLinesToPoints: false,
      convertPolysToLines: false,
      convertStripsToPolys: false,
    },
    inputs: [
      {
        pd: makeLines(),
        expect: { points: 3, verts: 0, lines: 3, polys: 0, strips: 0 },
      },
      {
        pd: makePolys(),
        expect: { points: 3, verts: 0, lines: 0, polys: 1, strips: 0 },
      },
      {
        pd: makeStrips(),
        expect: { points: 4, verts: 0, lines: 0, polys: 0, strips: 1 },
      },
    ],
  },
];

// ----------------------------------------------------------------------------
// 3) Run through all tests, log expected vs actual
// ----------------------------------------------------------------------------

TESTS.forEach(({ name, config, inputs }) => {
  console.group(`=== ${name} ===`);
  const cleaner = vtkCleanPolyData.newInstance(config);

  inputs.forEach(({ pd, expect }, idx) => {
    cleaner.setInputData(pd);
    cleaner.update();
    const out = cleaner.getOutputData();
    // for (let i = 0; i < out.getNumberOfPoints(); i++) {
    //   const pt = out.getPoints().getPoint(i);
    //   console.log(`${i} = (${pt})`);
    // }

    console.log(
      `${
        out.getNumberOfPoints() === expect.points ? '✅' : '❌'
      } expected pts=${expect.points}, got=${out.getNumberOfPoints()}`
    );
    console.log(
      `${
        out.getNumberOfVerts() === expect.verts ? '✅' : '❌'
      } expected verts=${expect.verts}, got=${out.getNumberOfVerts()}`
    );
    console.log(
      `${
        out.getNumberOfLines() === expect.lines ? '✅' : '❌'
      } expected lines=${expect.lines}, got=${out.getNumberOfLines()}`
    );
    console.log(
      `${
        out.getNumberOfPolys() === expect.polys ? '✅' : '❌'
      } expected polys=${expect.polys}, got=${out.getNumberOfPolys()}`
    );
    console.log(
      `${
        out.getNumberOfStrips() === expect.strips ? '✅' : '❌'
      } expected strips=${expect.strips}, got=${out.getNumberOfStrips()}`
    );
  });

  console.groupEnd();
});
