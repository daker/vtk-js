export interface LiteHttpDataAccessHelper {
  fetchArray(
    instance: any,
    baseURL: string,
    array: object[],
    options?: object
  ): Promise<object[]>;
  fetchJSON(instance: any, url: string, options?: object): Promise<object>;
  fetchText(instance: any, url: string, options?: object): Promise<string>;
  fetchBinary(
    instance: any,
    url: string,
    options?: object
  ): Promise<ArrayBuffer>;
  fetchImage(
    instance: any,
    url: string,
    options?: object
  ): Promise<HTMLImageElement>;
}

declare const LiteHttpDataAccessHelper: LiteHttpDataAccessHelper;
export default LiteHttpDataAccessHelper;
