// import { mat3, mat4, vec3 } from 'gl-matrix';
import { mat4 } from 'gl-matrix';

import * as macro from 'vtk.js/Sources/macros';
import vtkHelper from 'vtk.js/Sources/Rendering/OpenGL/Helper';
import vtkPoints from 'vtk.js/Sources/Common/Core/Points';
import vtkPolyData2DFS from 'vtk.js/Sources/Rendering/OpenGL/glsl/vtkPolyData2DFS.glsl';
import vtkPolyData2DVS from 'vtk.js/Sources/Rendering/OpenGL/glsl/vtkPolyData2DVS.glsl';
import vtkReplacementShaderMapper from 'vtk.js/Sources/Rendering/OpenGL/ReplacementShaderMapper';
import vtkShaderProgram from 'vtk.js/Sources/Rendering/OpenGL/ShaderProgram';
import vtkViewNode from 'vtk.js/Sources/Rendering/SceneGraph/ViewNode';
import vtkOpenGLTexture from 'vtk.js/Sources/Rendering/OpenGL/Texture';

import { round } from 'vtk.js/Sources/Common/Core/Math';

import { DisplayLocation } from 'vtk.js/Sources/Rendering/Core/Property2D/Constants';

import { registerOverride } from 'vtk.js/Sources/Rendering/OpenGL/ViewNodeFactory';

const { primTypes } = vtkHelper;
const { Filter, Wrap } = vtkOpenGLTexture;
const { vtkErrorMacro } = macro;
const StartEvent = { type: 'StartEvent' };
const EndEvent = { type: 'EndEvent' };

// ----------------------------------------------------------------------------
// vtkOpenGLPolyDataMapper2D methods
// ----------------------------------------------------------------------------

function vtkOpenGLPolyDataMapper2D(publicAPI, model) {
  // Set our className
  model.classHierarchy.push('vtkOpenGLPolyDataMapper2D');

  publicAPI.buildPass = (prepass) => {
    if (prepass) {
      model.openGLActor2D =
        publicAPI.getFirstAncestorOfType('vtkOpenGLActor2D');
      model._openGLRenderer =
        model.openGLActor2D.getFirstAncestorOfType('vtkOpenGLRenderer');
      model._openGLRenderWindow = model._openGLRenderer.getLastAncestorOfType(
        'vtkOpenGLRenderWindow'
      );
      model.openGLCamera = model._openGLRenderer.getViewNodeFor(
        model._openGLRenderer.getRenderable().getActiveCamera()
      );
    }
  };

  publicAPI.overlayPass = (prepass) => {
    if (prepass) {
      publicAPI.render();
    }
  };

  publicAPI.getShaderTemplate = (shaders, ren, actor) => {
    shaders.Vertex = vtkPolyData2DVS;
    shaders.Fragment = vtkPolyData2DFS;
    shaders.Geometry = '';
  };

  publicAPI.render = () => {
    const ctx = model._openGLRenderWindow.getContext();
    if (model.context !== ctx) {
      model.context = ctx;
      for (let i = primTypes.Start; i < primTypes.End; i++) {
        model.primitives[i].setOpenGLRenderWindow(model._openGLRenderWindow);
      }
    }
    const actor = model.openGLActor2D.getRenderable();
    const ren = model._openGLRenderer.getRenderable();
    publicAPI.renderPiece(ren, actor);
  };

  publicAPI.renderPiece = (ren, actor) => {
    publicAPI.invokeEvent(StartEvent);
    if (!model.renderable.getStatic()) {
      model.renderable.update();
    }
    model.currentInput = model.renderable.getInputData();
    publicAPI.invokeEvent(EndEvent);

    if (!model.currentInput) {
      vtkErrorMacro('No input!');
      return;
    }

    // if there are no points then we are done
    if (
      !model.currentInput.getPoints ||
      !model.currentInput.getPoints().getNumberOfValues()
    ) {
      return;
    }

    // cull back face to avoid double drawing
    const gl = model.context;
    model._openGLRenderWindow.enableCullFace();
    gl.cullFace(gl.BACK);

    publicAPI.renderPieceStart(ren, actor);
    publicAPI.renderPieceDraw(ren, actor);
    publicAPI.renderPieceFinish(ren, actor);
  };

  publicAPI.renderPieceStart = (ren, actor) => {
    model.primitiveIDOffset = 0;

    if (model._openGLRenderer.getSelector()) {
      switch (model._openGLRenderer.getSelector().getCurrentPass()) {
        default:
          model._openGLRenderer.getSelector().renderProp(actor);
      }
    }

    // If we are coloring by texture, then load the texture map.
    // Use Map as indicator, because texture hangs around.
    if (model.renderable.getColorTextureMap()) {
      model.internalColorTexture.activate();
    }

    // make sure the BOs are up to date
    publicAPI.updateBufferObjects(ren, actor);

    // Bind the OpenGL, this is shared between the different primitive/cell types.
    model.lastBoundBO = null;
  };

  publicAPI.getNeedToRebuildShaders = (cellBO, ren, actor) => {
    // has something changed that would require us to recreate the shader?
    // candidates are
    // property modified (representation interpolation and lighting)
    // input modified
    // light complexity changed
    if (
      cellBO.getShaderSourceTime().getMTime() < model.renderable.getMTime() ||
      cellBO.getShaderSourceTime().getMTime() < model.currentInput.getMTime()
    ) {
      return true;
    }

    return false;
  };

  publicAPI.updateBufferObjects = (ren, actor) => {
    // Rebuild buffers if needed
    if (publicAPI.getNeedToRebuildBufferObjects(ren, actor)) {
      publicAPI.buildBufferObjects(ren, actor);
    }
  };

  publicAPI.getNeedToRebuildBufferObjects = (ren, actor) => {
    // first do a coarse check
    // Note that the actor's mtime includes it's properties mtime
    const vmtime = model.VBOBuildTime.getMTime();
    if (
      vmtime < publicAPI.getMTime() ||
      vmtime < model._openGLRenderWindow.getMTime() ||
      vmtime < model.renderable.getMTime() ||
      vmtime < actor.getMTime() ||
      vmtime < model.currentInput.getMTime() ||
      (model.renderable.getTransformCoordinate() && vmtime < ren.getMTime())
    ) {
      return true;
    }
    return false;
  };

  publicAPI.buildBufferObjects = (ren, actor) => {
    const poly = model.currentInput;

    if (poly === null) {
      return;
    }

    model.renderable.mapScalars(poly, actor.getProperty().getOpacity());
    const c = model.renderable.getColorMapColors();
    const representation = actor.getProperty().getRepresentation();

    let tcoords = poly.getPointData().getTCoords();
    if (!model.openGLActor2D.getActiveTextures()) {
      tcoords = null;
    }

    // Flag to check if tcoords are per cell instead of per point
    let useTCoordsPerCell = false;
    // handle color mapping via texture
    if (model.renderable.getColorCoordinates()) {
      tcoords = model.renderable.getColorCoordinates();
      useTCoordsPerCell = model.renderable.getAreScalarsMappedFromCells();
      if (!model.internalColorTexture) {
        model.internalColorTexture = vtkOpenGLTexture.newInstance({
          resizable: true,
        });
      }
      const tex = model.internalColorTexture;
      // the following 4 lines allow for NPOT textures
      tex.setMinificationFilter(Filter.NEAREST);
      tex.setMagnificationFilter(Filter.NEAREST);
      tex.setWrapS(Wrap.CLAMP_TO_EDGE);
      tex.setWrapT(Wrap.CLAMP_TO_EDGE);
      tex.setOpenGLRenderWindow(model._openGLRenderWindow);

      const input = model.renderable.getColorTextureMap();
      const ext = input.getExtent();
      const inScalars = input.getPointData().getScalars();
      tex.create2DFromRaw({
        width: ext[1] - ext[0] + 1,
        height: ext[3] - ext[2] + 1,
        numComps: inScalars.getNumberOfComponents(),
        dataType: inScalars.getDataType(),
        data: inScalars.getData(),
      });
      tex.activate();
      tex.sendParameters();
      tex.deactivate();
    }

    const transformCoordinate = model.renderable.getTransformCoordinate();

    const view = ren.getRenderWindow().getViews()[0];
    const vsize = view.getViewportSize(ren);
    const toString =
      `${poly.getMTime()}A${representation}B${poly.getMTime()}` +
      `C${c ? c.getMTime() : 1}` +
      `D${tcoords ? tcoords.getMTime() : 1}` +
      `E${transformCoordinate ? ren.getMTime() : 1}` +
      `F${vsize}`;
    if (model.VBOBuildString !== toString) {
      // Build the VBOs
      let points = poly.getPoints();
      if (transformCoordinate) {
        const p = vtkPoints.newInstance();
        const numPts = points.getNumberOfPoints();
        p.setNumberOfPoints(numPts);
        const point = [];
        for (let i = 0; i < numPts; ++i) {
          points.getPoint(i, point);
          transformCoordinate.setValue(point);
          const v = transformCoordinate.getComputedDoubleViewportValue(ren);
          p.setPoint(i, v[0], v[1], 0.0);
        }
        points = p;
      }
      const options = {
        points,
        tcoords,
        colors: c,
        cellOffset: 0,
        useTCoordsPerCell,
        haveCellScalars: model.renderable.getAreScalarsMappedFromCells(),
        customAttributes: model.renderable
          .getCustomShaderAttributes()
          .map((arrayName) => poly.getPointData().getArrayByName(arrayName)),
      };
      options.cellOffset += model.primitives[primTypes.Points]
        .getCABO()
        .createVBO(poly.getVerts(), 'verts', representation, options);
      options.cellOffset += model.primitives[primTypes.Lines]
        .getCABO()
        .createVBO(poly.getLines(), 'lines', representation, options);
      options.cellOffset += model.primitives[primTypes.Tris]
        .getCABO()
        .createVBO(poly.getPolys(), 'polys', representation, options);
      options.cellOffset += model.primitives[primTypes.TriStrips]
        .getCABO()
        .createVBO(poly.getStrips(), 'strips', representation, options);

      model.VBOBuildTime.modified();
      model.VBOBuildString = toString;
    }
  };

  publicAPI.renderPieceDraw = (ren, actor) => {
    const representation = actor.getProperty().getRepresentation();
    const gl = model.context;
    gl.depthMask(true);

    // for every primitive type
    for (let i = primTypes.Start; i < primTypes.End; i++) {
      // if there are entries
      const cabo = model.primitives[i].getCABO();
      if (cabo.getElementCount()) {
        model.lastBoundBO = model.primitives[i];
        model.primitiveIDOffset += model.primitives[i].drawArrays(
          ren,
          actor,
          representation,
          publicAPI
        );
      }
    }
  };

  publicAPI.renderPieceFinish = (ren, actor) => {
    if (model.lastBoundBO) {
      model.lastBoundBO.getVAO().release();
    }
    if (model.renderable.getColorTextureMap()) {
      model.internalColorTexture.deactivate();
    }
  };

  publicAPI.replaceShaderValues = (shaders, ren, actor) => {
    publicAPI.replaceShaderColor(shaders, ren, actor);
    publicAPI.replaceShaderTCoord(shaders, ren, actor);
    publicAPI.replaceShaderPicking(shaders, ren, actor);
    publicAPI.replaceShaderPositionVC(shaders, ren, actor);
  };

  publicAPI.replaceShaderColor = (shaders, ren, actor) => {
    let VSSource = shaders.Vertex;
    let GSSource = shaders.Geometry;
    let FSSource = shaders.Fragment;

    // create the color property declarations
    // these are always defined
    let colorDec = [
      'uniform vec3 diffuseColorUniform;',
      'uniform float opacityUniform;',
    ];

    // now handle the more complex fragment shader implementation
    let colorImpl = [
      'vec3 diffuseColor = diffuseColorUniform;',
      'float opacity = opacityUniform;',
    ];

    // add scalar vertex colors
    if (model.lastBoundBO.getCABO().getColorComponents() !== 0) {
      colorDec = colorDec.concat(['varying vec4 vertexColorVSOutput;']);
      VSSource = vtkShaderProgram.substitute(VSSource, '//VTK::Color::Dec', [
        'attribute vec4 scalarColor;',
        'varying vec4 vertexColorVSOutput;',
      ]).result;
      VSSource = vtkShaderProgram.substitute(VSSource, '//VTK::Color::Impl', [
        'vertexColorVSOutput =  scalarColor;',
      ]).result;
      GSSource = vtkShaderProgram.substitute(GSSource, '//VTK::Color::Dec', [
        'in vec4 vertexColorVSOutput[];',
        'out vec4 vertexColorGSOutput;',
      ]).result;
      GSSource = vtkShaderProgram.substitute(GSSource, '//VTK::Color::Impl', [
        'vertexColorGSOutput = vertexColorVSOutput[i];',
      ]).result;
      FSSource = vtkShaderProgram.substitute(
        FSSource,
        '//VTK::Color::Impl',
        colorImpl.concat([
          '  diffuseColor = vertexColorVSOutput.rgb;',
          '  opacity = opacity*vertexColorVSOutput.a;',
        ])
      ).result;
    } else if (model.renderable.getAreScalarsMappedFromCells()) {
      colorImpl = colorImpl.concat([
        '  vec4 texColor = texture2D(texture1, tcoordVCVSOutput.st);',
        '  diffuseColor = texColor.rgb;',
        '  opacity = opacity*texColor.a;',
      ]);
    }

    colorImpl = colorImpl.concat([
      'gl_FragData[0] = vec4(diffuseColor, opacity);',
    ]);

    FSSource = vtkShaderProgram.substitute(
      FSSource,
      '//VTK::Color::Dec',
      colorDec
    ).result;
    FSSource = vtkShaderProgram.substitute(
      FSSource,
      '//VTK::Color::Impl',
      colorImpl
    ).result;

    shaders.Vertex = VSSource;
    shaders.Geometry = GSSource;
    shaders.Fragment = FSSource;
  };

  publicAPI.replaceShaderTCoord = (shaders, ren, actor) => {
    if (model.lastBoundBO.getCABO().getTCoordOffset()) {
      let VSSource = shaders.Vertex;
      let GSSource = shaders.Geometry;
      let FSSource = shaders.Fragment;

      const tcdim = model.lastBoundBO.getCABO().getTCoordComponents();
      if (tcdim === 1) {
        VSSource = vtkShaderProgram.substitute(VSSource, '//VTK::TCoord::Dec', [
          'in float tcoordMC;',
          'out float tcoordVCVSOutput;',
        ]).result;
        VSSource = vtkShaderProgram.substitute(
          VSSource,
          '//VTK::TCoord::Impl',
          ['tcoordVCVSOutput = tcoordMC;']
        ).result;
        GSSource = vtkShaderProgram.substitute(GSSource, '//VTK::TCoord::Dec', [
          'in float tcoordVCVSOutput[];\n',
          'out float tcoordVCGSOutput;',
        ]).result;
        GSSource = vtkShaderProgram.substitute(GSSource, [
          '//VTK::TCoord::Impl',
          'tcoordVCGSOutput = tcoordVCVSOutput[i];',
        ]).result;
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::TCoord::Dec', [
          'in float tcoordVCVSOutput;',
          'uniform sampler2D texture1;',
        ]).result;
        FSSource = vtkShaderProgram.substitute(
          FSSource,
          '//VTK::TCoord::Impl',
          [
            'gl_FragData[0] = gl_FragData[0]*texture2D(texture1, vec2(tcoordVCVSOutput,0));',
          ]
        ).result;
      } else if (tcdim === 2) {
        VSSource = vtkShaderProgram.substitute(VSSource, '//VTK::TCoord::Dec', [
          'in vec2 tcoordMC;',
          'out vec2 tcoordVCVSOutput;',
        ]).result;
        VSSource = vtkShaderProgram.substitute(
          VSSource,
          '//VTK::TCoord::Impl',
          ['tcoordVCVSOutput = tcoordMC;']
        ).result;
        GSSource = vtkShaderProgram.substitute(GSSource, '//VTK::TCoord::Dec', [
          'in vec2 tcoordVCVSOutput[];\n',
          'out vec2 tcoordVCGSOutput;',
        ]).result;
        GSSource = vtkShaderProgram.substitute(
          GSSource,
          '//VTK::TCoord::Impl',
          ['tcoordVCGSOutput = tcoordVCVSOutput[i];']
        ).result;
        FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::TCoord::Dec', [
          'in vec2 tcoordVCVSOutput;',
          'uniform sampler2D texture1;',
        ]).result;
        FSSource = vtkShaderProgram.substitute(
          FSSource,
          '//VTK::TCoord::Impl',
          [
            'gl_FragData[0] = gl_FragData[0]*texture2D(texture1, tcoordVCVSOutput.st);',
          ]
        ).result;
      }

      if (model.renderable.getAreScalarsMappedFromCells()) {
        GSSource = vtkShaderProgram.substitute(
          GSSource,
          '//VTK::PrimID::Impl',
          ['gl_PrimitiveID = gl_PrimitiveIDIn;']
        ).result;
      }
      shaders.Vertex = VSSource;
      shaders.Geometry = GSSource;
      shaders.Fragment = FSSource;
    }
  };

  publicAPI.replaceShaderPicking = (shaders, ren, actor) => {
    let FSSource = shaders.Fragment;
    FSSource = vtkShaderProgram.substitute(FSSource, '//VTK::Picking::Dec', [
      'uniform vec3 mapperIndex;',
      'uniform int picking;',
    ]).result;
    FSSource = vtkShaderProgram.substitute(
      FSSource,
      '//VTK::Picking::Impl',
      '  gl_FragData[0] = picking != 0 ? vec4(mapperIndex,1.0) : gl_FragData[0];'
    ).result;
    shaders.Fragment = FSSource;
  };

  publicAPI.replaceShaderPositionVC = (shaders, ren, actor) => {
    // replace common shader code
    model.lastBoundBO.replaceShaderPositionVC(shaders, ren, actor);
  };

  publicAPI.invokeShaderCallbacks = (cellBO, ren, actor) => {
    const listCallbacks =
      model.renderable.getViewSpecificProperties().ShadersCallbacks;
    if (listCallbacks) {
      listCallbacks.forEach((object) => {
        object.callback(object.userData, cellBO, ren, actor);
      });
    }
  };

  publicAPI.setMapperShaderParameters = (cellBO, ren, actor) => {
    // Now to update the VAO too, if necessary.
    if (cellBO.getProgram().isUniformUsed('PrimitiveIDOffset')) {
      cellBO
        .getProgram()
        .setUniformi('PrimitiveIDOffset', model.primitiveIDOffset);
    }

    if (cellBO.getProgram().isAttributeUsed('vertexWC')) {
      if (
        !cellBO
          .getVAO()
          .addAttributeArray(
            cellBO.getProgram(),
            cellBO.getCABO(),
            'vertexWC',
            cellBO.getCABO().getVertexOffset(),
            cellBO.getCABO().getStride(),
            model.context.FLOAT,
            3,
            false
          )
      ) {
        vtkErrorMacro('Error setting vertexWC in shader VAO.');
      }
    }
    if (
      cellBO.getCABO().getElementCount() &&
      (model.VBOBuildTime.getMTime() >
        cellBO.getAttributeUpdateTime().getMTime() ||
        cellBO.getShaderSourceTime().getMTime() >
          cellBO.getAttributeUpdateTime().getMTime())
    ) {
      model.renderable.getCustomShaderAttributes().forEach((attrName, idx) => {
        if (cellBO.getProgram().isAttributeUsed(`${attrName}MC`)) {
          if (
            !cellBO
              .getVAO()
              .addAttributeArray(
                cellBO.getProgram(),
                cellBO.getCABO(),
                `${attrName}MC`,
                cellBO.getCABO().getCustomData()[idx].offset,
                cellBO.getCABO().getStride(),
                model.context.FLOAT,
                cellBO.getCABO().getCustomData()[idx].components,
                false
              )
          ) {
            vtkErrorMacro(`Error setting ${attrName}MC in shader VAO.`);
          }
        }
      });

      if (
        cellBO.getProgram().isAttributeUsed('tcoordMC') &&
        cellBO.getCABO().getTCoordOffset()
      ) {
        if (
          !cellBO
            .getVAO()
            .addAttributeArray(
              cellBO.getProgram(),
              cellBO.getCABO(),
              'tcoordMC',
              cellBO.getCABO().getTCoordOffset(),
              cellBO.getCABO().getStride(),
              model.context.FLOAT,
              cellBO.getCABO().getTCoordComponents(),
              false
            )
        ) {
          vtkErrorMacro('Error setting tcoordMC in shader VAO.');
        }
      } else {
        cellBO.getVAO().removeAttributeArray('tcoordMC');
      }
      if (
        cellBO.getProgram().isAttributeUsed('scalarColor') &&
        cellBO.getCABO().getColorComponents()
      ) {
        if (
          !cellBO
            .getVAO()
            .addAttributeArray(
              cellBO.getProgram(),
              cellBO.getCABO().getColorBO(),
              'scalarColor',
              cellBO.getCABO().getColorOffset(),
              cellBO.getCABO().getColorBOStride(),
              model.context.UNSIGNED_BYTE,
              4,
              true
            )
        ) {
          vtkErrorMacro('Error setting scalarColor in shader VAO.');
        }
      } else {
        cellBO.getVAO().removeAttributeArray('scalarColor');
      }
      if (
        model.internalColorTexture &&
        cellBO.getProgram().isUniformUsed('texture1')
      ) {
        const texUnit = model.internalColorTexture.getTextureUnit();
        if (texUnit > -1) {
          cellBO
            .getProgram()
            .setUniformi(
              'texture1',
              model.internalColorTexture.getTextureUnit()
            );
        }
      }
      const tus = model.openGLActor2D.getActiveTextures();
      if (tus) {
        for (let index = 0; index < tus.length; ++index) {
          const tex = tus[index];
          const texUnit = tex.getTextureUnit();
          const tname = `texture${texUnit + 1}`;
          if (cellBO.getProgram().isUniformUsed(tname)) {
            cellBO.getProgram().setUniformi(tname, texUnit);
          }
        }
      }

      // handle wide lines
      cellBO.setMapperShaderParameters(
        ren,
        actor,
        model._openGLRenderer.getTiledSizeAndOrigin()
      );

      const selector = model._openGLRenderer.getSelector();
      cellBO
        .getProgram()
        .setUniform3fArray(
          'mapperIndex',
          selector ? selector.getPropColorValue() : [0.0, 0.0, 0.0]
        );
      cellBO
        .getProgram()
        .setUniformi('picking', selector ? selector.getCurrentPass() + 1 : 0);
    }
  };

  publicAPI.setPropertyShaderParameters = (cellBO, ren, actor) => {
    const c = model.renderable.getColorMapColors();
    if (!c || c.getNumberOfComponents() === 0) {
      const program = cellBO.getProgram();
      const ppty = actor.getProperty();
      const opacity = ppty.getOpacity();
      program.setUniformf('opacityUniform', opacity);
      const dColor = ppty.getColor();
      program.setUniform3fArray('diffuseColorUniform', dColor);
    }
  };

  publicAPI.setLightingShaderParameters = (cellBO, ren, actor) => {
    // no-op
  };

  function safeMatrixMultiply(matrixArray, matrixType, tmpMat) {
    matrixType.identity(tmpMat);
    return matrixArray.reduce((res, matrix, index) => {
      if (index === 0) {
        return matrix ? matrixType.copy(res, matrix) : matrixType.identity(res);
      }
      return matrix ? matrixType.multiply(res, res, matrix) : res;
    }, tmpMat);
  }

  publicAPI.setCameraShaderParameters = (cellBO, ren, actor) => {
    const program = cellBO.getProgram();

    const shiftScaleEnabled = cellBO.getCABO().getCoordShiftAndScaleEnabled();
    const inverseShiftScaleMatrix = shiftScaleEnabled
      ? cellBO.getCABO().getInverseShiftAndScaleMatrix()
      : null;

    // Get the position of the actor
    const view = ren.getRenderWindow().getViews()[0];
    const size = view.getViewportSize(ren);
    const vport = ren.getViewport();
    const actorPos = actor
      .getActualPositionCoordinate()
      .getComputedDoubleViewportValue(ren);

    // Get the window info
    // Assume tile viewport is 0 1 based on vtkOpenGLRenderer
    const tileViewport = [0.0, 0.0, 1.0, 1.0];
    const visVP = [0.0, 0.0, 1.0, 1.0];
    visVP[0] = vport[0] >= tileViewport[0] ? vport[0] : tileViewport[0];
    visVP[1] = vport[1] >= tileViewport[1] ? vport[1] : tileViewport[1];
    visVP[2] = vport[2] <= tileViewport[2] ? vport[2] : tileViewport[2];
    visVP[3] = vport[3] <= tileViewport[3] ? vport[3] : tileViewport[3];
    if (visVP[0] >= visVP[2]) {
      return;
    }
    if (visVP[1] >= visVP[3]) {
      return;
    }
    size[0] = round((size[0] * (visVP[2] - visVP[0])) / (vport[2] - vport[0]));
    size[1] = round((size[1] * (visVP[3] - visVP[1])) / (vport[3] - vport[1]));

    const winSize = model._openGLRenderer.getParent().getSize();

    const xoff = round(actorPos[0] - (visVP[0] - vport[0]) * winSize[0]);
    const yoff = round(actorPos[1] - (visVP[1] - vport[1]) * winSize[1]);

    // set ortho projection
    const left = -xoff;
    let right = -xoff + size[0];
    const bottom = -yoff;
    let top = -yoff + size[1];

    // it's an error to call glOrtho with
    // either left==right or top==bottom
    if (left === right) {
      right = left + 1.0;
    }
    if (bottom === top) {
      top = bottom + 1.0;
    }

    // compute the combined ModelView matrix and send it down to save time in the shader
    const tmpMat4 = mat4.identity(new Float64Array(16));
    tmpMat4[0] = 2.0 / (right - left);
    tmpMat4[1 * 4 + 1] = 2.0 / (top - bottom);
    tmpMat4[0 * 4 + 3] = (-1.0 * (right + left)) / (right - left);
    tmpMat4[1 * 4 + 3] = (-1.0 * (top + bottom)) / (top - bottom);
    tmpMat4[2 * 4 + 2] = 0.0;
    tmpMat4[2 * 4 + 3] =
      actor.getProperty().getDisplayLocation() === DisplayLocation.FOREGROUND
        ? -1.0
        : 1.0;
    tmpMat4[3 * 4 + 3] = 1.0;
    mat4.transpose(tmpMat4, tmpMat4);
    program.setUniformMatrix(
      'WCVCMatrix',
      safeMatrixMultiply(
        [tmpMat4, inverseShiftScaleMatrix],
        mat4,
        model.tmpMat4
      )
    );
  };

  publicAPI.getAllocatedGPUMemoryInBytes = () => {
    let memUsed = 0;
    model.primitives.forEach((prim) => {
      memUsed += prim.getAllocatedGPUMemoryInBytes();
    });
    // Return in MB
    return memUsed;
  };
}

// ----------------------------------------------------------------------------
// Object factory
// ----------------------------------------------------------------------------

const DEFAULT_VALUES = {
  context: null,
  VBOBuildTime: 0,
  VBOBuildString: null,
  primitives: null,
  primTypes: null,
  shaderRebuildString: null,
};

// ----------------------------------------------------------------------------

export function extend(publicAPI, model, initialValues = {}) {
  Object.assign(model, DEFAULT_VALUES, initialValues);

  // Inheritance
  vtkViewNode.extend(publicAPI, model, initialValues);
  vtkReplacementShaderMapper.implementReplaceShaderCoincidentOffset(
    publicAPI,
    model,
    initialValues
  );
  vtkReplacementShaderMapper.implementBuildShadersWithReplacements(
    publicAPI,
    model,
    initialValues
  );

  model.primitives = [];
  model.primTypes = primTypes;

  model.tmpMat4 = mat4.identity(new Float64Array(16));

  for (let i = primTypes.Start; i < primTypes.End; i++) {
    model.primitives[i] = vtkHelper.newInstance();
    model.primitives[i].setPrimitiveType(i);
    model.primitives[i].set(
      { lastLightComplexity: 0, lastLightCount: 0, lastSelectionPass: false },
      true
    );
  }

  // Build VTK API
  macro.setGet(publicAPI, model, ['context']);

  model.VBOBuildTime = {};
  macro.obj(model.VBOBuildTime, { mtime: 0 });

  // Object methods
  vtkOpenGLPolyDataMapper2D(publicAPI, model);
}

// ----------------------------------------------------------------------------

export const newInstance = macro.newInstance(
  extend,
  'vtkOpenGLPolyDataMapper2D'
);

// ----------------------------------------------------------------------------

export default { newInstance, extend };

// Register ourself to OpenGL backend if imported
registerOverride('vtkMapper2D', newInstance);
