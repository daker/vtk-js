//VTK::Define::Dec
//VTK::Light::Dec
const float PI = 3.14159265359;
const float recPI = 0.31830988618;

// Texture uniforms
uniform sampler2D DiffuseTexture;
uniform sampler2D ORMTexture;
uniform sampler2D RMTexture;
uniform sampler2D RoughnessTexture;
uniform sampler2D MetallicTexture;
uniform sampler2D AmbientOcclusionTexture;
uniform sampler2D EmissionTexture;
uniform sampler2D NormalTexture;
uniform sampler2D EnvironmentTexture;

// Material uniforms
uniform float aoStrengthUniform;
uniform float roughnessUniform;
uniform float metallicUniform;
uniform float emissionUniform;
uniform float normalStrengthUniform;
uniform float environmentTextureDiffuseStrength;
uniform float environmentTextureSpecularStrength;
uniform float environmentTextureMaxMipLevel;

vec2 environmentLatLong(vec3 dir) {
  vec3 d = normalize(dir);
  float twoPI = 6.28318530718;
  float pi = 3.14159265359;
  float u = atan(d.z, d.x) / twoPI + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) / pi + 0.5;
  return vec2(u, v);
}

// GGX/Trowbridge-Reitz normal distribution function
float D_GGX(float NdH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float d = (NdH * a2 - NdH) * NdH + 1.0;
  return a2 / (PI * d * d);
}

// Smith visibility term using correlated formulation
float V_SmithCorrelated(float NdV, float NdL, float roughness) {
  float a2 = roughness * roughness;
  float ggxV = NdL * sqrt(a2 + NdV * (NdV - a2 * NdV));
  float ggxL = NdV * sqrt(a2 + NdL * (NdL - a2 * NdL));
  return 0.5 / (ggxV + ggxL);
}

// Fresnel term (Schlick approximation)
vec3 F_Schlick(vec3 F0, float HdL) {
  return F0 + (1.0 - F0) * pow(1.0 - HdL, 5.0);
}

// Lambertian diffuse BRDF
vec3 DiffuseLambert(vec3 albedo) {
  return albedo * recPI;
}

// Cook-Torrance BRDF returning reflected radiance for a single light
vec3 CookTorranceBRDF(
  vec3 N,
  vec3 V,
  vec3 L,
  vec3 albedo,
  float roughness,
  float metallic
) {
  vec3 H = normalize(V + L);

  float NdV = max(dot(N, V), 0.0);
  float NdL = max(dot(N, L), 0.0);
  float NdH = max(dot(N, H), 0.0);
  float HdV = max(dot(H, V), 0.0);
  float HdL = max(dot(H, L), 0.0);

  if (NdL <= 0.0 || NdV <= 0.0) {
    return vec3(0.0);
  }

  vec3 F0 = mix(vec3(0.04), albedo, metallic);

  float D = D_GGX(NdH, roughness);
  float G = V_SmithCorrelated(NdV, NdL, roughness);
  vec3 F = F_Schlick(F0, HdL);

  vec3 specular = (D * G * F) / (4.0 * NdV * NdL + 1e-5);

  vec3 kS = F;
  vec3 kD = vec3(1.0) - kS;
  kD *= 1.0 - metallic;

  vec3 diffuse = kD * DiffuseLambert(albedo);

  return (diffuse + specular) * NdL;
}

// Environment texture sampling helpers (lat-long mapping with explicit LOD)
vec3 SampleEnvironmentDiffuseIBL(vec3 N) {
  vec2 uvDiff = environmentLatLong(N);
  vec3 envDiff = texture2DLod(EnvironmentTexture, uvDiff, environmentTextureMaxMipLevel).rgb;
  return envDiff * environmentTextureDiffuseStrength;
}

vec3 SampleEnvironmentSpecularIBL(vec3 R, float roughness) {
  vec2 uvSpec = environmentLatLong(R);
  float level = clamp(roughness, 0.0, 1.0) * environmentTextureMaxMipLevel;
  vec3 envSpec = texture2DLod(EnvironmentTexture, uvSpec, level).rgb;
  return envSpec * environmentTextureSpecularStrength;
}
