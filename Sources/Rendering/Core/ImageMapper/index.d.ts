import { vtkCamera } from '../Camera';
import {
  vtkAbstractImageMapper,
  IAbstractImageMapperInitialValues,
} from '../AbstractImageMapper';
import { Bounds, Nullable, Vector3 } from '../../../types';
import { SlicingMode } from './Constants';
import { vtkImageData } from '../../../Common/DataModel/ImageData';
import {
  CoincidentTopologyHelper,
  StaticCoincidentTopologyMethods,
} from '../Mapper/CoincidentTopologyHelper';

export interface IClosestIJKAxis {
  ijkMode: SlicingMode;
  flip: boolean;
}

export interface IImageMapperInitialValues
  extends IAbstractImageMapperInitialValues {
  closestIJKAxis?: IClosestIJKAxis;
  renderToRectangle?: boolean;
  sliceAtFocalPoint?: boolean;
}

export interface vtkImageMapper
  extends vtkAbstractImageMapper,
    CoincidentTopologyHelper {
  /**
   * Returns the IJK slice value from a world position or XYZ slice value
   * @param {Vector3 | number} [pos] World point or XYZ slice value
   */
  getSliceAtPosition(pos: Vector3 | number): number;

  /**
   * Get the closest IJK axis
   * @return {IClosestIJKAxis} The axis object.
   */
  getClosestIJKAxis(): IClosestIJKAxis;

  /**
   * Get the bounds for this mapper as [xmin, xmax, ymin, ymax,zmin, zmax].
   * @return {Bounds} The bounds for the mapper.
   */
  getBounds(): Bounds;

  /**
   * Get the bounds for a given slice as [xmin, xmax, ymin, ymax,zmin, zmax].
   * @param {Number} [slice] The slice index. If undefined, the current slice is considered.
   * @param {Number} [halfThickness] Half the slice thickness in index space (unit voxel
   * spacing). If undefined, 0 is considered.
   * @return {Bounds} The bounds for a given slice.
   */
  getBoundsForSlice(slice?: number, halfThickness?: number): Bounds;

  /**
   *
   */
  getIsOpaque(): boolean;

  /**
   *
   */
  getRenderToRectangle(): boolean;

  /**
   * Return currently active image. By default, there can only be one image
   * for this mapper, if an input is set.
   */
  getCurrentImage(): Nullable<vtkImageData>;

  /**
   * Get the slice number at a focal point.
   */
  getSliceAtFocalPoint(): boolean;

  /**
   *
   * @param {Number[]} p1 The coordinates of the first point.
   * @param {Number[]} p2 The coordinates of the second point.
   */
  intersectWithLineForPointPicking(p1: number[], p2: number[]): any;

  /**
   *
   * @param {Number[]} p1 The coordinates of the first point.
   * @param {Number[]} p2 The coordinates of the second point.
   */
  intersectWithLineForCellPicking(p1: number[], p2: number[]): any;

  /**
   * Set the closest IJK axis
   * @param {IClosestIJKAxis} closestIJKAxis The axis object.
   */
  setClosestIJKAxis(closestIJKAxis: IClosestIJKAxis): boolean;

  /**
   *
   * @param {Boolean} renderToRectangle
   */
  setRenderToRectangle(renderToRectangle: boolean): boolean;

  /**
   *
   * @param {Number} slice The slice index.
   */
  setSlice(slice: number): boolean;

  /**
   * Set the slice from a given camera.
   * @param {vtkCamera} cam The camera object.
   */
  setSliceFromCamera(cam: vtkCamera): boolean;

  /**
   * Set the slice from a given focal point.
   * @param {Boolean} sliceAtFocalPoint
   */
  setSliceAtFocalPoint(sliceAtFocalPoint: boolean): boolean;

  /**
   * Set the slice for the X axis.
   * @param {Number} id The slice index.
   */
  setXSlice(id: number): boolean;

  /**
   * Set the slice for the Y axis.
   * @param {Number} id The slice index.
   */
  setYSlice(id: number): boolean;

  /**
   * Set the slice for the Z axis.
   * @param {Number} id The slice index.
   */
  setZSlice(id: number): boolean;

  /**
   * Set the slice for the I axis.
   * @param {Number} id The slice index.
   */
  setISlice(id: number): boolean;

  /**
   * Set the slice for the J axis.
   * @param {Number} id The slice index.
   */
  setJSlice(id: number): boolean;

  /**
   * Set the slice for the K axis.
   * @param {Number} id The slice index.
   */
  setKSlice(id: number): boolean;

  /**
   *
   */
  getSlicingModeNormal(): number[];

  /**
   * Get the slicing mode.
   */
  getSlicingMode(): SlicingMode;

  /**
   * Set the slicing mode.
   * @param {SlicingMode} mode The slicing mode.
   */
  setSlicingMode(mode: SlicingMode): boolean;

  /**
   * Get the preference to use halfFloat representation of float
   */
  getPreferSizeOverAccuracy(): boolean;

  /**
   * Set the preference to use halfFloat representation of float
   * @param {Boolean} preferSizeOverAccuracy
   */
  setPreferSizeOverAccuracy(preferSizeOverAccuracy: boolean): boolean;
}

/**
 * Method use to decorate a given object (publicAPI+model) with vtkImageMapper characteristics.
 *
 * @param publicAPI object on which methods will be bounds (public)
 * @param model object on which data structure will be bounds (protected)
 * @param {IImageMapperInitialValues} [initialValues] (default: {})
 */
export function extend(
  publicAPI: object,
  model: object,
  initialValues?: IImageMapperInitialValues
): void;

/**
 * Method use to create a new instance of vtkImageMapper
 * @param {IImageMapperInitialValues} [initialValues] for pre-setting some of its content
 */
export function newInstance(
  initialValues?: IImageMapperInitialValues
): vtkImageMapper;

/**
 * vtkImageMapper provides 2D image display support for vtk.
 * It can be associated with a vtkImageSlice prop and placed within a Renderer.
 *
 * This class resolves coincident topology with the same methods as vtkMapper.
 */
export declare const vtkImageMapper: {
  newInstance: typeof newInstance;
  extend: typeof extend;
  SlicingMode: typeof SlicingMode;
} & StaticCoincidentTopologyMethods;

export default vtkImageMapper;
