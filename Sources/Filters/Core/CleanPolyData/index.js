import macro from 'vtk.js/Sources/macros';
import vtkIncrementalOctreePointLocator from 'vtk.js/Sources/Common/DataModel/IncrementalOctreePointLocator';
import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';
import vtkPoints from 'vtk.js/Sources/Common/Core/Points';
import vtkCellArray from 'vtk.js/Sources/Common/Core/CellArray';
import { VtkDataTypes } from 'vtk.js/Sources/Common/Core/DataArray/Constants';

// ----------------------------------------------------------------------------
// vtkCleanPolyData methods
// ----------------------------------------------------------------------------
function vtkCleanPolyData(publicAPI, model) {
  model.classHierarchy.push('vtkCleanPolyData');

  publicAPI.requestData = (inData, outData) => {
    if (!publicAPI.getNumberOfInputPorts()) return;
    const input = inData[0];
    if (!input) return;

    const inPts = input.getPoints();
    if (!inPts) return;
    const nInPts = inPts.getNumberOfPoints();
    const oldToMergedId = new Array(nInPts);

    // --- Step 1: Point merging, build mapping from input to (possibly merged) output point ids
    let mergedPts;
    if (model.pointMerging) {
      const tol = model.toleranceIsAbsolute
        ? model.absoluteTolerance
        : model.tolerance;
      const precision = model.outputPointsPrecision;
      let pointType = inPts.getDataType();
      if (precision) {
        pointType =
          precision === 'double' ? VtkDataTypes.DOUBLE : VtkDataTypes.FLOAT;
      }
      mergedPts = vtkPoints.newInstance({ dataType: pointType });
      const locator = vtkIncrementalOctreePointLocator.newInstance({
        tolerance: tol,
      });
      locator.initPointInsertion(mergedPts, input.getBounds());
      for (let i = 0; i < nInPts; ++i) {
        const pt = inPts.getPoint(i);
        const { idx } = locator.insertUniquePoint(pt);
        oldToMergedId[i] = idx;
      }
    } else {
      mergedPts = vtkPoints.newInstance();
      for (let i = 0; i < nInPts; ++i) {
        mergedPts.insertNextTuple(inPts.getPoint(i));
        oldToMergedId[i] = i;
      }
    }
    // Number of "merged" points may be smaller (with merging) or the same as input

    // --- Step 2: Collect output cells and which merged points are actually used
    const usedPointSet = new Set();

    function getUniqueIds(arr) {
      // Only remove *consecutive* duplicates (VTK behavior). For simplicity, here we remove all.
      return Array.from(new Set(arr));
    }

    function convertAndCollectCells(inCA, cellType, cellArrays) {
      if (!inCA) return;
      const indt = inCA.getData();
      let i = 0;
      while (i < indt.length) {
        const npts = indt[i++];
        const mergedIds = [];
        for (let j = 0; j < npts; ++j) {
          mergedIds.push(oldToMergedId[indt[i++]]);
        }
        const uniqueIds = getUniqueIds(mergedIds);

        // Conversion logic
        if (cellType === 'verts') {
          if (uniqueIds.length === 1) {
            cellArrays.verts.push([...uniqueIds]);
            usedPointSet.add(uniqueIds[0]);
          }
        } else if (cellType === 'lines') {
          if (uniqueIds.length > 1) {
            cellArrays.lines.push([...uniqueIds]);
            uniqueIds.forEach((id) => usedPointSet.add(id));
          } else if (uniqueIds.length === 1 && model.convertLinesToPoints) {
            cellArrays.verts.push([...uniqueIds]);
            usedPointSet.add(uniqueIds[0]);
          }
        } else if (cellType === 'polys') {
          if (uniqueIds.length > 2) {
            cellArrays.polys.push([...uniqueIds]);
            uniqueIds.forEach((id) => usedPointSet.add(id));
          } else if (uniqueIds.length === 2 && model.convertPolysToLines) {
            cellArrays.lines.push([...uniqueIds]);
            uniqueIds.forEach((id) => usedPointSet.add(id));
          } else if (uniqueIds.length === 1 && model.convertLinesToPoints) {
            cellArrays.verts.push([...uniqueIds]);
            usedPointSet.add(uniqueIds[0]);
          }
        } else if (cellType === 'strips') {
          if (uniqueIds.length > 3) {
            cellArrays.strips.push([...uniqueIds]);
            uniqueIds.forEach((id) => usedPointSet.add(id));
          } else if (uniqueIds.length === 3 && model.convertStripsToPolys) {
            cellArrays.polys.push([...uniqueIds]);
            uniqueIds.forEach((id) => usedPointSet.add(id));
          } else if (uniqueIds.length === 2 && model.convertPolysToLines) {
            cellArrays.lines.push([...uniqueIds]);
            uniqueIds.forEach((id) => usedPointSet.add(id));
          } else if (uniqueIds.length === 1 && model.convertLinesToPoints) {
            cellArrays.verts.push([...uniqueIds]);
            usedPointSet.add(uniqueIds[0]);
          }
        }
      }
    }

    // Collect all output cells as arrays of ids
    const collected = { verts: [], lines: [], polys: [], strips: [] };
    convertAndCollectCells(input.getVerts(), 'verts', collected);
    convertAndCollectCells(input.getLines(), 'lines', collected);
    convertAndCollectCells(input.getPolys(), 'polys', collected);
    convertAndCollectCells(input.getStrips(), 'strips', collected);

    // --- Step 3: Compact point array to only include used points
    // Build mapping: old merged point id -> new compacted id
    const usedIds = Array.from(usedPointSet);
    // usedIds.sort((a, b) => a - b); // sort for reproducibility
    const mergedToCompactedId = {};
    usedIds.forEach((id, compactedId) => {
      mergedToCompactedId[id] = compactedId;
    });

    const compactedPts = vtkPoints.newInstance();
    usedIds.forEach((id) => {
      compactedPts.insertNextTuple(mergedPts.getPoint(id));
    });

    // --- Step 4: Remap cells to compacted ids and assemble vtkCellArrays
    function makeCellArray(cellList) {
      const ca = vtkCellArray.newInstance();
      cellList.forEach((cell) => {
        ca.insertNextCell(cell.map((id) => mergedToCompactedId[id]));
      });
      return ca;
    }
    const outVerts = makeCellArray(collected.verts);
    const outLines = makeCellArray(collected.lines);
    const outPolys = makeCellArray(collected.polys);
    const outStrips = makeCellArray(collected.strips);

    // --- Step 5: Output PolyData
    const output = vtkPolyData.newInstance();
    output.setPoints(compactedPts);
    output.setVerts(outVerts);
    output.setLines(outLines);
    output.setPolys(outPolys);
    output.setStrips(outStrips);

    if (input.getPointData())
      output.getPointData().passData(input.getPointData());
    if (input.getCellData()) output.getCellData().passData(input.getCellData());
    if (input.getFieldData())
      output.getFieldData().passData(input.getFieldData());

    outData[0] = output;
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------
function defaultValues(initialValues) {
  return {
    pointMerging: true,
    toleranceIsAbsolute: false,
    tolerance: 0.0,
    absoluteTolerance: 1.0,
    convertPolysToLines: true,
    convertLinesToPoints: true,
    convertStripsToPolys: true,
    outputPointsPrecision: null,
    ...initialValues,
  };
}

// ----------------------------------------------------------------------------
export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, defaultValues(initialValues));
  macro.obj(publicAPI, model);
  macro.algo(publicAPI, model, 1, 1);
  macro.setGet(publicAPI, model, [
    'pointMerging',
    'toleranceIsAbsolute',
    'tolerance',
    'absoluteTolerance',
    'convertPolysToLines',
    'convertLinesToPoints',
    'convertStripsToPolys',
    'outputPointsPrecision',
  ]);
  vtkCleanPolyData(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkCleanPolyData');
export default { newInstance, extend };
