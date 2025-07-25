import * as macro from 'vtk.js/Sources/macros';
import vtkDataArray from 'vtk.js/Sources/Common/Core/DataArray';
import vtkPolyData from 'vtk.js/Sources/Common/DataModel/PolyData';

const { vtkErrorMacro } = macro;

function initPolyIterator(pd) {
  const polys = pd.getPolys().getData();
  const strips = pd.getStrips().getData();
  const it = {
    cellSize: 0,
    cell: [],
    done: false,
    polyIdx: 0,
    stripIdx: 0,
    remainingStripLength: 0,

    // returns a single poly cell
    next() {
      if (it.polyIdx < polys.length) {
        it.cellSize = polys[it.polyIdx];
        const start = it.polyIdx + 1;
        const end = start + it.cellSize;
        it.polyIdx = end;
        let p = 0;
        for (let i = start; i < end; ++i) {
          it.cell[p++] = polys[i];
        }
      } else if (it.stripIdx < strips.length) {
        it.cellSize = 3;
        if (it.remainingStripLength === 0) {
          it.remainingStripLength = strips[it.stripIdx] - 2; // sliding window of 3 points
          // stripIdx points to the last point in a triangle 3-tuple
          it.stripIdx += 3;
        }
        const start = it.stripIdx - 2;
        const end = it.stripIdx + 1;
        it.stripIdx++;
        it.remainingStripLength--;
        let p = 0;
        for (let i = start; i < end; ++i) {
          it.cell[p++] = strips[i];
        }
      } else if (!it.done) {
        it.done = true;
      } else {
        throw new Error('Iterator is done');
      }
    },
  };
  it.next();
  return it;
}

// ----------------------------------------------------------------------------
// vtkCutter methods
// ----------------------------------------------------------------------------

function vtkCutter(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkCutter');

  // Capture "parentClass" api for internal use
  const superClass = { ...publicAPI };

  publicAPI.getMTime = () => {
    let mTime = superClass.getMTime();
    if (!model.cutFunction) {
      return mTime;
    }

    mTime = Math.max(mTime, model.cutFunction.getMTime());
    return mTime;
  };

  function dataSetCutter(input, output) {
    const points = input.getPoints();
    const pointsData = points.getData();
    const pointData = input.getPointData();
    const numPts = points.getNumberOfPoints();
    const newPointsData = [];
    const newLinesData = [];
    const newPolysData = [];
    const newPointData = {}; // TODO: cell data must also be processed

    // Initialize arrays
    const numberOfArrays = pointData.getNumberOfArrays();
    for (let arrayIdx = 0; arrayIdx < numberOfArrays; arrayIdx++) {
      newPointData[pointData.getArrayName(arrayIdx)] = [];
    }

    if (!model.cutScalars || model.cutScalars.length < numPts) {
      model.cutScalars = new Float32Array(numPts);
    }

    // Loop over all points evaluating scalar function at each point
    let inOffset = 0;
    let outOffset = 0;
    while (inOffset < pointsData.length) {
      model.cutScalars[outOffset++] = model.cutFunction.evaluateFunction(
        pointsData[inOffset++],
        pointsData[inOffset++],
        pointsData[inOffset++]
      );
    }

    const crossedEdges = [];
    const x1 = new Array(3);
    const x2 = new Array(3);
    const cellPointsScalars = [];

    // Loop over all cells; get scalar values for all cell points
    // and process each cell.
    /* eslint-disable no-continue */
    for (const it = initPolyIterator(input); !it.done; it.next()) {
      // cell contains the point IDs/indices

      // Check that cells have at least 3 points
      if (it.cellSize <= 2) {
        continue;
      }

      // Get associated scalar of points that constitute the current cell
      for (let i = 0; i < it.cellSize; ) {
        cellPointsScalars[i] = model.cutScalars[it.cell[i++]];
      }

      // Check if all cell points are on same side (same side == cell not crossed by cut function)
      // TODO: won't work if one point scalar is = 0 ?
      const sideFirstPoint = cellPointsScalars[0] > 0;
      let allPointsSameSide = true;
      for (let i = 1; i < it.cell.length; i++) {
        const sideCurrentPoint = cellPointsScalars[i] > 0;
        if (sideCurrentPoint !== sideFirstPoint) {
          allPointsSameSide = false;
          break;
        }
      }

      // Go to next cell if cell is not crossed by cut function
      if (allPointsSameSide) {
        continue;
      }

      // Find and compute edges which intersect cells
      const intersectedEdgesList = [];
      for (let i = 0; i < it.cellSize; i++) {
        const idNext = i + 1 === it.cellSize ? 0 : i + 1;

        // Go to next edge if edge is not crossed
        // TODO: in most come cases, (numberOfPointsInCell - 1) or 0 edges of the cell
        // will be crossed, but if it crosses right at a point, it could be intersecting
        // with (numberOfPoints) or 1 edge(s). Do we account for that?
        const signPoint0 = cellPointsScalars[i] > 0;
        const signPoint1 = cellPointsScalars[idNext] > 0;
        if (signPoint1 === signPoint0) {
          continue;
        }

        // Compute preferred interpolation direction
        let e1 = i;
        let e2 = idNext;
        let deltaScalar = cellPointsScalars[e2] - cellPointsScalars[e1];
        if (deltaScalar <= 0) {
          e1 = idNext;
          e2 = i;
          deltaScalar *= -1;
        }

        // linear interpolation
        let t = 0.0;
        if (deltaScalar !== 0.0) {
          t = (model.cutValue - cellPointsScalars[e1]) / deltaScalar;
        }

        // points position
        const pointID1 = it.cell[e1];
        const pointID2 = it.cell[e2];
        x1[0] = pointsData[pointID1 * 3];
        x1[1] = pointsData[pointID1 * 3 + 1];
        x1[2] = pointsData[pointID1 * 3 + 2];
        x2[0] = pointsData[pointID2 * 3];
        x2[1] = pointsData[pointID2 * 3 + 1];
        x2[2] = pointsData[pointID2 * 3 + 2];

        // Compute the intersected point on edge
        const computedIntersectedPoint = [
          x1[0] + t * (x2[0] - x1[0]),
          x1[1] + t * (x2[1] - x1[1]),
          x1[2] + t * (x2[2] - x1[2]),
        ];

        const computedIntersectedArrays = {};
        for (let arrayIdx = 0; arrayIdx < numberOfArrays; arrayIdx++) {
          const array = pointData.getArrayByIndex(arrayIdx);
          const name = pointData.getArrayName(arrayIdx);
          const data = array.getData();
          const n = array.getNumberOfComponents();
          const computedIntersectedArray = new Array(n);
          for (let j = 0; j < n; j++) {
            const scalar1 = data[n * pointID1 + j];
            const scalar2 = data[n * pointID2 + j];
            computedIntersectedArray.push(scalar1 + t * (scalar2 - scalar1)); // FIXME: won't work when the array contains "normals" or "IDs"
          }
          computedIntersectedArrays[name] = computedIntersectedArray;
        }

        // Keep track of it
        intersectedEdgesList.push({
          pointEdge1: pointID1, // id of one point of the edge
          pointEdge2: pointID2, // id of one point of the edge
          intersectedPoint: computedIntersectedPoint, // 3D coordinate of points that intersected edge
          intersectedArrays: computedIntersectedArrays, // value(s) of the intersected arrays
          newPointID: -1, // id of the intersected point when it will be added into vtkPoints
        });
      }

      // Add points into newPointList
      for (let i = 0; i < intersectedEdgesList.length; i++) {
        const intersectedEdge = intersectedEdgesList[i];
        let alreadyAdded = false;
        // Check if point/edge already added
        for (let j = 0; j < crossedEdges.length; j++) {
          const crossedEdge = crossedEdges[j];
          const sameEdge =
            intersectedEdge.pointEdge1 === crossedEdge.pointEdge1 &&
            intersectedEdge.pointEdge2 === crossedEdge.pointEdge2;
          const samePoint =
            intersectedEdge.intersectedPoint[0] ===
              crossedEdge.intersectedPoint[0] &&
            intersectedEdge.intersectedPoint[1] ===
              crossedEdge.intersectedPoint[1] &&
            intersectedEdge.intersectedPoint[2] ===
              crossedEdge.intersectedPoint[2];
          if (sameEdge || samePoint) {
            alreadyAdded = true;
            intersectedEdgesList[i].newPointID = crossedEdges[j].newPointID;
            break;
          }
        }
        if (!alreadyAdded) {
          newPointsData.push(intersectedEdge.intersectedPoint[0]);
          newPointsData.push(intersectedEdge.intersectedPoint[1]);
          newPointsData.push(intersectedEdge.intersectedPoint[2]);
          Object.keys(intersectedEdge.intersectedArrays).forEach((name) => {
            newPointData[name].push(...intersectedEdge.intersectedArrays[name]);
          });
          intersectedEdgesList[i].newPointID = newPointsData.length / 3 - 1;
          crossedEdges.push(intersectedEdgesList[i]);
        }
      }

      // Store cells
      const cellSize = intersectedEdgesList.length;
      if (cellSize === 2) {
        newLinesData.push(
          cellSize,
          intersectedEdgesList[0].newPointID,
          intersectedEdgesList[1].newPointID
        );
      } else if (cellSize > 2) {
        newPolysData.push(cellSize);
        intersectedEdgesList.forEach((edge) => {
          newPolysData.push(edge.newPointID);
        });
      }
    }

    // Set points
    const outputPoints = output.getPoints();
    outputPoints.setData(
      macro.newTypedArrayFrom(points.getDataType(), newPointsData),
      3
    );

    // Set scalars
    const outputPointData = output.getPointData();
    for (let arrayIdx = 0; arrayIdx < numberOfArrays; arrayIdx++) {
      const name = pointData.getArrayName(arrayIdx);
      const array = vtkDataArray.newInstance({
        name,
        values: newPointData[name],
        numberOfComponents: pointData
          .getArrayByIndex(arrayIdx)
          .getNumberOfComponents(),
      });
      outputPointData.addArray(array);
    }

    // Set lines
    if (newLinesData.length !== 0) {
      output.getLines().setData(Uint16Array.from(newLinesData));
    }

    // Set polys
    if (newPolysData.length !== 0) {
      output.getPolys().setData(Uint16Array.from(newPolysData));
    }
  }

  // expose requestData
  publicAPI.requestData = (inData, outData) => {
    // implement requestData
    const input = inData[0];

    if (!input) {
      vtkErrorMacro('Invalid or missing input');
      return;
    }

    if (!model.cutFunction) {
      vtkErrorMacro('Missing cut function');
      return;
    }

    const output = vtkPolyData.newInstance();

    dataSetCutter(input, output);

    outData[0] = output;
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  cutFunction: null, // support method with evaluateFunction method
  cutScalars: null,
  cutValue: 0.0,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Make this a VTK object
  macro.obj(publicAPI, model);

  // Also make it an algorithm with one input and one output
  macro.algo(publicAPI, model, 1, 1);

  // Set implicit function use to cut the input data (is vtkPlane)
  macro.setGet(publicAPI, model, ['cutFunction', 'cutValue']);

  // Object specific methods
  vtkCutter(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(extend, 'vtkCutter');

// ----------------------------------------------------------------------------

export default { newInstance, extend };
