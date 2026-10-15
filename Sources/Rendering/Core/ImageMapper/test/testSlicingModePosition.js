import { it, expect } from 'vitest';
import vtkImageMapper from 'vtk.js/Sources/Rendering/Core/ImageMapper';
import { SlicingMode } from 'vtk.js/Sources/Rendering/Core/ImageMapper/Constants';
import vtkImageSlice from 'vtk.js/Sources/Rendering/Core/ImageSlice';
import vtkRTAnalyticSource from 'vtk.js/Sources/Filters/Sources/RTAnalyticSource';

it('Test slice position differences between XYZ and IJK modes', () => {
  const source = vtkRTAnalyticSource.newInstance({
    wholeExtent: [0, 10, 0, 10, 0, 10],
  });
  source.update();
  const image = source.getOutputData();
  image.setSpacing([10, 10, 10]);
  global.image = image;
  const mapper = vtkImageMapper.newInstance();
  const slice = vtkImageSlice.newInstance();
  mapper.setInputData(image);

  slice.setMapper(mapper);

  mapper.setSlicingMode(SlicingMode.Z);

  expect(3).toBe(mapper.getSliceAtPosition(30));
  expect(3.5).toBe(mapper.getSliceAtPosition(35));

  expect(5).toBe(mapper.getSliceAtPosition([0, 0, 50]));
  expect(5.5).toBe(mapper.getSliceAtPosition([0, 0, 55]));

  expect(0).toBe(mapper.getSliceAtPosition(-1));
  expect(10).toBe(mapper.getSliceAtPosition(110));
});

it('Test scalar world position in IJK modes with negative origin', () => {
  const source = vtkRTAnalyticSource.newInstance({
    wholeExtent: [0, 10, 0, 10, 0, 10],
  });
  source.update();
  const image = source.getOutputData();
  image.setSpacing([2, 2, 2]);
  image.setOrigin([-200, -100, -50]);
  const mapper = vtkImageMapper.newInstance();
  mapper.setInputData(image);

  mapper.setSlicingMode(SlicingMode.K);
  expect(mapper.getSliceAtPosition(-40)).toBe(5);
  expect(mapper.getSliceAtPosition(-60)).toBe(0);

  mapper.setSlicingMode(SlicingMode.J);
  expect(mapper.getSliceAtPosition(-94)).toBe(3);

  mapper.setSlicingMode(SlicingMode.I);
  expect(mapper.getSliceAtPosition(-181)).toBe(9.5);

  // K axis along world X: the scalar is a world X position.
  image.setDirection([0, 0, 1, 0, 1, 0, 1, 0, 0]);
  mapper.setSlicingMode(SlicingMode.K);
  expect(mapper.getSliceAtPosition(-196)).toBe(2);
});
