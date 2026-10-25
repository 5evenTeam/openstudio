import fs from "node:fs";
import * as nodePath from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeState } from "./bridge/state.js";
import { BRIDGE_VERSION, HEARTBEAT_STALE_MS, UPDATE_MANIFEST_URL, runtimeDir } from "./config.js";
import { sendStudioCommand } from "./bridge/dispatch.js";

export function registerTools(server: McpServer, state: BridgeState): void {
  const okText = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });

  const uiNodeSchema: z.ZodType<any> = z.lazy(() =>
    z.object({
      name: z.string().min(1).optional(),
      className: z.string().min(1),
      class: z.string().min(1).optional(),
      properties: z
        .array(z.object({ name: z.string().min(1), type: z.string().min(1), value: z.string() }))
        .optional(),
      props: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      children: z.array(z.lazy(() => uiNodeSchema)).optional().default([]),
    }),
  );

  const modelObjectSchema = z.object({
    name: z.string().optional(),
    shape: z.string().optional(),
    type: z.string().optional(),
    size: z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).optional(),
    position: z.object({ x: z.number().optional(), y: z.number().optional(), z: z.number().optional() }).optional(),
    rotation: z.array(z.number()).optional(),
    color: z.union([z.string(), z.array(z.number())]).optional(),
    material: z.string().optional(),
    transparency: z.number().optional(),
    anchored: z.boolean().optional(),
    parent: z.string().optional(),
  }).passthrough();

  const permissionError = (required: string) => okText({
    ok: false,
    error: `This operation requires ${required} permission (current: ${state.permissionLevel}).`,
  });

  server.tool("openstudio_status", "Check OpenStudio bridge and Roblox Studio connection status", {}, async () => {
    return okText({
      bridge: "running",
      studioConnected: state.isStudioConnected(HEARTBEAT_STALE_MS),
      lastHeartbeat: state.connection?.lastHeartbeat ?? null,
      clientId: state.connection?.clientId ?? null,
      capabilities: state.connection?.capabilities ?? [],
      pendingCommands: state.pendingCount(),
    });
  });

  server.tool(
    "openstudio_connect",
    "Wait for the Roblox Studio OpenStudio plugin to connect",
    { timeoutMs: z.number().int().min(1000).max(30_000).optional() },
    async ({ timeoutMs }) => {
      const maxWait = timeoutMs ?? 10_000;
      const started = Date.now();
      while (Date.now() - started < maxWait) {
        if (state.isStudioConnected(HEARTBEAT_STALE_MS)) {
          return okText({
            connected: true,
            clientId: state.connection?.clientId ?? null,
            capabilities: state.connection?.capabilities ?? [],
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return okText({
        connected: state.isStudioConnected(HEARTBEAT_STALE_MS),
        clientId: state.connection?.clientId ?? null,
        hint: "Start Roblox Studio, enable the OpenStudio plugin, then run this tool again.",
      });
    },
  );

  server.tool(
    "openstudio_list_scripts",
    "Ask Roblox Studio to list script instances",
    { root: z.string().optional() },
    async ({ root }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "list_scripts", {
        root: root ?? "game",
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_read_script",
    "Read a script's Source from Roblox Studio by instance path",
    { path: z.string().min(1) },
    async ({ path }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "read_script", { path });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_write_script",
    "Write Source to an existing script in Roblox Studio",
    { path: z.string().min(1), source: z.string() },
    async ({ path, source }) => {
      if (!state.hasPermission("scripts-only")) {
        return permissionError("scripts-only");
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "write_script", {
        path,
        source,
      });
      const data = result.data as { previousSource?: string } | undefined;
      let backupPath: string | undefined;
      if (result.ok && data?.previousSource !== undefined) {
        const sanitized = path.replace(/[^a-zA-Z0-9._-]/g, "_");
        const backupDir = nodePath.join(runtimeDir(), "backups");
        fs.mkdirSync(backupDir, { recursive: true });
        backupPath = nodePath.join(backupDir, `${sanitized}.${Date.now()}.luau`);
        fs.writeFileSync(backupPath, data.previousSource, "utf8");
      }
      return okText({ ...result, backupPath });
    },
  );

  server.tool(
    "openstudio_create_script",
    "Create a new script in Roblox Studio",
    {
      parentPath: z.string().min(1),
      name: z.string().min(1),
      scriptType: z.enum(["Script", "LocalScript", "ModuleScript"]).default("Script"),
      source: z.string().default(""),
    },
    async ({ parentPath, name, scriptType, source }) => {
      if (!state.hasPermission("scripts-only")) {
        return permissionError("scripts-only");
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "create_script", {
        parentPath,
        name,
        scriptType,
        source,
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_get_selection",
    "Get the current Roblox Studio selection",
    {},
    async () => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "get_selection", {});
      return okText(result);
    },
  );

  server.tool(
    "openstudio_get_instance_tree",
    "Get a bounded Roblox Studio instance tree",
    {
      root: z.string().optional(),
      depth: z.number().int().min(1).max(8).optional(),
      maxNodes: z.number().int().min(1).max(500).optional(),
    },
    async ({ root, depth, maxNodes }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "get_instance_tree", {
        root: root ?? "game",
        depth: depth ?? 3,
        maxNodes: maxNodes ?? 100,
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_create_instance",
    "Create an instance in Roblox Studio",
    {
      parentPath: z.string().min(1),
      className: z.string().min(1),
      name: z.string().min(1),
      properties: z
        .array(
          z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            value: z.string(),
          }),
        )
        .optional(),
    },
    async ({ parentPath, className, name, properties }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "create_instance", {
        parentPath,
        className,
        name,
        properties: properties ?? [],
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_set_property",
    "Set a property on a Roblox Studio instance",
    {
      path: z.string().min(1),
      propertyName: z.string().min(1),
      valueType: z.enum(["string", "number", "boolean", "Vector3", "Color3", "BrickColor", "UDim2", "UDim", "EnumItem", "Instance"]),
      value: z.string(),
    },
    async ({ path, propertyName, valueType, value }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path,
        propertyName,
        valueType,
        value,
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_get_output",
    "Drain buffered Roblox Studio output/log messages captured by the plugin",
    {},
    async () => {
      return okText({ logs: state.drainLogs() });
    },
  );

  server.tool(
    "openstudio_execute_lua",
    "Execute arbitrary Lua in the Roblox Studio plugin context. Dangerous: can modify or delete the open place.",
    { code: z.string().min(1), confirm: z.boolean().optional() },
    async ({ code, confirm }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      if (!confirm) {
        return okText({ ok: false, error: "Pass confirm: true to execute Lua." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "execute_lua", { code });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_delete_script",
    "Delete a script in Roblox Studio",
    { path: z.string().min(1), confirm: z.boolean().optional() },
    async ({ path, confirm }) => {
      if (!state.hasPermission("scripts-only")) {
        return permissionError("scripts-only");
      }
      if (!confirm) {
        return okText({ ok: false, error: "Pass confirm: true to delete a script." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "delete_script", { path });
      return okText(result);
    },
  );
 server.tool(
    "openstudio_import_blender",
    "Import a Blender scene export into Roblox Studio as positioned Parts",
    {
      parentPath: z.string().optional(),
      filePath: z.string().optional(),
      scale: z.number().optional(),
      scene: z.any().optional(),
    },
    async ({ parentPath, filePath, scale, scene }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      try {
        let resolvedScene = scene;
        if (filePath) {
          if (!fs.existsSync(filePath)) {
            return okText({ ok: false, error: "Blender scene file not found." });
          }
          resolvedScene = JSON.parse(fs.readFileSync(filePath, "utf8"));
        }
        if (!resolvedScene || !Array.isArray(resolvedScene.objects)) {
          return okText({ ok: false, error: "Blender scene must contain an objects array." });
        }
        const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_blender", {
          parentPath: parentPath ?? "game.Workspace",
          scale: scale ?? resolvedScene.scale ?? 1,
          objects: resolvedScene.objects,
        });
        return okText(result);
      } catch (error) {
        return okText({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
  async function createVisualInstance(parentPath: string, className: string, name: string, properties: Array<{ name: string; type: string; value: string }> = []) {
    const created = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "create_instance", {
      parentPath,
      className,
      name,
      properties: [],
    });
    if (!created.ok) {
      throw new Error(created.error ?? "create failed");
    }
    const instancePath = (created.data as { path?: string } | undefined)?.path;
    if (!instancePath) {
      throw new Error("create_instance did not return a path");
    }
    for (const property of properties) {
      await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path: instancePath,
        propertyName: property.name,
        valueType: property.type as any,
        value: property.value,
      });
    }
    return instancePath;
  }

  server.tool("openstudio_create_particle_emitter", "Create a ParticleEmitter", { parentPath: z.string().min(1), rate: z.number().optional() }, async ({ parentPath, rate }) => {
    try {
      const p = await createVisualInstance(parentPath, "ParticleEmitter", "ParticleEmitter", [
        { name: "Rate", type: "number", value: String(rate ?? 20) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_fire", "Create a Fire effect", { parentPath: z.string().min(1), size: z.number().optional(), heat: z.number().optional() }, async ({ parentPath, size, heat }) => {
    try {
      const p = await createVisualInstance(parentPath, "Fire", "Fire", [
        { name: "Size", type: "number", value: String(size ?? 5) },
        { name: "Heat", type: "number", value: String(heat ?? 9) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_smoke", "Create a Smoke effect", { parentPath: z.string().min(1), size: z.number().optional() }, async ({ parentPath, size }) => {
    try {
      const p = await createVisualInstance(parentPath, "Smoke", "Smoke", [
        { name: "Size", type: "number", value: String(size ?? 1) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_sparkles", "Create Sparkles", { parentPath: z.string().min(1) }, async ({ parentPath }) => {
    try {
      const p = await createVisualInstance(parentPath, "Sparkles", "Sparkles", []);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_explosion", "Create an Explosion", { parentPath: z.string().min(1), blastRadius: z.number().optional() }, async ({ parentPath, blastRadius }) => {
    try {
      const p = await createVisualInstance(parentPath, "Explosion", "Explosion", [
        { name: "BlastRadius", type: "number", value: String(blastRadius ?? 10) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  function colorProps(prefix: string, r: number, g: number, b: number) {
    return { name: prefix, type: "Color3", value: `${r / 255},${g / 255},${b / 255}` };
  }

  server.tool("openstudio_create_point_light", "Create a PointLight", { parentPath: z.string().min(1), brightness: z.number().optional(), range: z.number().optional(), r: z.number().optional(), g: z.number().optional(), b: z.number().optional() }, async ({ parentPath, brightness, range, r, g, b }) => {
    try {
      const p = await createVisualInstance(parentPath, "PointLight", "PointLight", [
        { name: "Brightness", type: "number", value: String(brightness ?? 1) },
        { name: "Range", type: "number", value: String(range ?? 16) },
        colorProps("Color", r ?? 255, g ?? 255, b ?? 255),
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_spot_light", "Create a SpotLight", { parentPath: z.string().min(1), brightness: z.number().optional(), range: z.number().optional(), angle: z.number().optional(), r: z.number().optional(), g: z.number().optional(), b: z.number().optional() }, async ({ parentPath, brightness, range, angle, r, g, b }) => {
    try {
      const p = await createVisualInstance(parentPath, "SpotLight", "SpotLight", [
        { name: "Brightness", type: "number", value: String(brightness ?? 1) },
        { name: "Range", type: "number", value: String(range ?? 16) },
        { name: "Angle", type: "number", value: String(angle ?? 45) },
        colorProps("Color", r ?? 255, g ?? 255, b ?? 255),
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_surface_light", "Create a SurfaceLight", { parentPath: z.string().min(1), brightness: z.number().optional(), range: z.number().optional(), r: z.number().optional(), g: z.number().optional(), b: z.number().optional() }, async ({ parentPath, brightness, range, r, g, b }) => {
    try {
      const p = await createVisualInstance(parentPath, "SurfaceLight", "SurfaceLight", [
        { name: "Brightness", type: "number", value: String(brightness ?? 1) },
        { name: "Range", type: "number", value: String(range ?? 16) },
        colorProps("Color", r ?? 255, g ?? 255, b ?? 255),
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_trail", "Create a Trail between two attachments", { parentPath: z.string().min(1) }, async ({ parentPath }) => {
    try {
      const attachment0 = await createVisualInstance(parentPath, "Attachment", "TrailAttachment0", []);
      const attachment1 = await createVisualInstance(parentPath, "Attachment", "TrailAttachment1", []);
      const trail = await createVisualInstance(parentPath, "Trail", "Trail", [
        { name: "Lifetime", type: "number", value: "1" },
        { name: "MinLength", type: "number", value: "0.1" },
      ]);
      await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path: trail,
        propertyName: "Attachment0",
        valueType: "Instance" as any,
        value: attachment0,
      }).catch(() => undefined);
      await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path: trail,
        propertyName: "Attachment1",
        valueType: "Instance" as any,
        value: attachment1,
      }).catch(() => undefined);
      return okText({ ok: true, trail, attachment0, attachment1 });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_beam", "Create a Beam between two attachments", { parentPath: z.string().min(1) }, async ({ parentPath }) => {
    try {
      const attachment0 = await createVisualInstance(parentPath, "Attachment", "BeamAttachment0", []);
      const attachment1 = await createVisualInstance(parentPath, "Attachment", "BeamAttachment1", []);
      const beam = await createVisualInstance(parentPath, "Beam", "Beam", [
        { name: "Width0", type: "number", value: "1" },
        { name: "Width1", type: "number", value: "1" },
      ]);
      await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path: beam,
        propertyName: "Attachment0",
        valueType: "Instance" as any,
        value: attachment0,
      }).catch(() => undefined);
      await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path: beam,
        propertyName: "Attachment1",
        valueType: "Instance" as any,
        value: attachment1,
      }).catch(() => undefined);
      return okText({ ok: true, beam, attachment0, attachment1 });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_highlight", "Create a Highlight", { parentPath: z.string().min(1), fillTransparency: z.number().optional(), outlineTransparency: z.number().optional() }, async ({ parentPath, fillTransparency, outlineTransparency }) => {
    try {
      const p = await createVisualInstance(parentPath, "Highlight", "Highlight", [
        { name: "FillTransparency", type: "number", value: String(fillTransparency ?? 0.5) },
        { name: "OutlineTransparency", type: "number", value: String(outlineTransparency ?? 0) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_atmosphere", "Create an Atmosphere in Lighting", { density: z.number().optional(), haze: z.number().optional(), glare: z.number().optional() }, async ({ density, haze, glare }) => {
    try {
      const p = await createVisualInstance("game.Lighting", "Atmosphere", "Atmosphere", [
        { name: "Density", type: "number", value: String(density ?? 0.3) },
        { name: "Haze", type: "number", value: String(haze ?? 0) },
        { name: "Glare", type: "number", value: String(glare ?? 0) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_bloom", "Create a BloomEffect in Lighting", { intensity: z.number().optional(), size: z.number().optional(), threshold: z.number().optional() }, async ({ intensity, size, threshold }) => {
    try {
      const p = await createVisualInstance("game.Lighting", "BloomEffect", "Bloom", [
        { name: "Intensity", type: "number", value: String(intensity ?? 0.5) },
        { name: "Size", type: "number", value: String(size ?? 24) },
        { name: "Threshold", type: "number", value: String(threshold ?? 1) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_color_correction", "Create a ColorCorrectionEffect in Lighting", { brightness: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional() }, async ({ brightness, contrast, saturation }) => {
    try {
      const p = await createVisualInstance("game.Lighting", "ColorCorrectionEffect", "ColorCorrection", [
        { name: "Brightness", type: "number", value: String(brightness ?? 0) },
        { name: "Contrast", type: "number", value: String(contrast ?? 0) },
        { name: "Saturation", type: "number", value: String(saturation ?? 0) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_sun_rays", "Create a SunRaysEffect in Lighting", { intensity: z.number().optional(), spread: z.number().optional() }, async ({ intensity, spread }) => {
    try {
      const p = await createVisualInstance("game.Lighting", "SunRaysEffect", "SunRays", [
        { name: "Intensity", type: "number", value: String(intensity ?? 0.25) },
        { name: "Spread", type: "number", value: String(spread ?? 0.5) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_depth_of_field", "Create a DepthOfFieldEffect in Lighting", { focusDistance: z.number().optional(), inFocusRadius: z.number().optional() }, async ({ focusDistance, inFocusRadius }) => {
    try {
      const p = await createVisualInstance("game.Lighting", "DepthOfFieldEffect", "DepthOfField", [
        { name: "FocusDistance", type: "number", value: String(focusDistance ?? 10) },
        { name: "InFocusRadius", type: "number", value: String(inFocusRadius ?? 5) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_blur", "Create a BlurEffect in Lighting", { size: z.number().optional() }, async ({ size }) => {
    try {
      const p = await createVisualInstance("game.Lighting", "BlurEffect", "Blur", [
        { name: "Size", type: "number", value: String(size ?? 10) },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_sky", "Create a Sky in Lighting", {}, async () => {
    try {
      const p = await createVisualInstance("game.Lighting", "Sky", "Sky", []);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_decal", "Create a Decal on a part surface", { parentPath: z.string().min(1), texture: z.string().min(1), face: z.string().optional() }, async ({ parentPath, texture, face }) => {
    try {
      const p = await createVisualInstance(parentPath, "Decal", "Decal", [
        { name: "Texture", type: "string", value: texture },
        { name: "Face", type: "EnumItem", value: `Enum.NormalId.${face ?? "Front"}` },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_texture", "Create a Texture on a part surface", { parentPath: z.string().min(1), texture: z.string().min(1), face: z.string().optional() }, async ({ parentPath, texture, face }) => {
    try {
      const p = await createVisualInstance(parentPath, "Texture", "Texture", [
        { name: "Texture", type: "string", value: texture },
        { name: "Face", type: "EnumItem", value: `Enum.NormalId.${face ?? "Front"}` },
      ]);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_set_lighting", "Set core Lighting environment properties", {
    brightness: z.number().optional(),
    clockTime: z.number().optional(),
    fogEnd: z.number().optional(),
    ambientR: z.number().optional(),
    ambientG: z.number().optional(),
    ambientB: z.number().optional(),
  }, async ({ brightness, clockTime, fogEnd, ambientR, ambientG, ambientB }) => {
    try {
      const properties = [];
      if (brightness !== undefined) properties.push({ name: "Brightness", type: "number", value: String(brightness) });
      if (clockTime !== undefined) properties.push({ name: "ClockTime", type: "number", value: String(clockTime) });
      if (fogEnd !== undefined) properties.push({ name: "FogEnd", type: "number", value: String(fogEnd) });
      if (ambientR !== undefined || ambientG !== undefined || ambientB !== undefined) {
        properties.push({ name: "Ambient", type: "Color3", value: `${(ambientR ?? 127) / 255},${(ambientG ?? 127) / 255},${(ambientB ?? 127) / 255}` });
      }
      for (const property of properties) {
        await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
          path: "game.Lighting",
          propertyName: property.name,
          valueType: property.type,
          value: property.value,
        });
      }
      return okText({ ok: true, updated: properties.length });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_set_part_material", "Set a part material by Enum name", { path: z.string().min(1), material: z.string().min(1) }, async ({ path, material }) => {
    try {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "set_property", {
        path,
        propertyName: "Material",
        valueType: "EnumItem",
        value: `Enum.Material.${material}`,
      });
      return okText(result);
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_emit_particles", "Emit a burst from a ParticleEmitter", { path: z.string().min(1), count: z.number().int().min(1).max(1000) }, async ({ path, count }) => {
    if (!state.hasPermission("full-edit")) {
      return permissionError("full-edit");
    }
    try {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "execute_lua", {
        code: `local emitter = game:FindFirstChild("${path.replace(/"/g, '\\"')}", true); if emitter and emitter:IsA("ParticleEmitter") then emitter:Emit(${count}); return "emitted" end; return "not found"`,
      });
      return okText(result);
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool("openstudio_create_radial_force", "Create a radial RadialForce for explosion effects", { parentPath: z.string().min(1) }, async ({ parentPath }) => {
    try {
      const p = await createVisualInstance(parentPath, "RadialForce", "RadialForce", []);
      return okText({ ok: true, path: p });
    } catch (error) { return okText({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  server.tool(
    "openstudio_version",
    "Report OpenStudio bridge/plugin version and environment details",
    {},
    async () => {
      return okText({
        bridgeVersion: BRIDGE_VERSION,
        permissionLevel: state.permissionLevel,
        studioConnected: state.isStudioConnected(10_000),
        studio: state.connection
          ? {
              clientId: state.connection.clientId,
              pluginVersion: state.connection.version,
              capabilities: state.connection.capabilities ?? [],
              gameName: state.connection.gameName,
              gameId: state.connection.gameId,
              placeId: state.connection.placeId,
              lastHeartbeat: state.connection.lastHeartbeat,
            }
          : null,
        pendingCommands: state.pendingCount(),
      });
    },
  );

  server.tool(
    "openstudio_cleanup_backups",
    "Remove older backup files, keeping the newest N",
    { path: z.string().min(1), keep: z.number().int().min(1).max(100).optional() },
    async ({ path, keep }) => {
      const keepCount = keep ?? 10;
      const sanitized = path.replace(/[^a-zA-Z0-9._-]/g, "_");
      const backupDir = nodePath.join(runtimeDir(), "backups");
      if (!fs.existsSync(backupDir)) {
        return okText({ ok: true, deleted: 0 });
      }
      const backups = fs
        .readdirSync(backupDir)
        .filter((entry) => entry.startsWith(sanitized + "."))
        .sort()
        .reverse();
      const toDelete = backups.slice(keepCount);
      for (const entry of toDelete) {
        fs.rmSync(nodePath.join(backupDir, entry), { force: true });
      }
      return okText({ ok: true, kept: Math.min(backups.length, keepCount), deleted: toDelete.length });
    },
  );
  server.tool("openstudio_check_update", "Check an update manifest for a newer OpenStudio version", {}, async () => {
    if (!UPDATE_MANIFEST_URL) {
      return okText({
        ok: false,
        currentVersion: BRIDGE_VERSION,
        error: "Set OPENSTUDIO_UPDATE_MANIFEST_URL to an update manifest JSON URL.",
      });
    }
    try {
      const { fetchUpdateManifest, isUpdateAvailable } = await import("./updater.js");
      const manifest = await fetchUpdateManifest(UPDATE_MANIFEST_URL);
      return okText({
        currentVersion: BRIDGE_VERSION,
        latestVersion: manifest.version ?? null,
        updateAvailable: isUpdateAvailable(BRIDGE_VERSION, manifest.version),
        url: manifest.url ?? null,
        notes: manifest.notes ?? null,
      });
    } catch (error) {
      return okText({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.tool("openstudio_download_update", "Download an update archive to the updates folder", { url: z.string().url().optional() }, async ({ url }) => {
    try {
      let resolvedUrl = url;
      if (!resolvedUrl && UPDATE_MANIFEST_URL) {
        const { fetchUpdateManifest } = await import("./updater.js");
        const manifest = await fetchUpdateManifest(UPDATE_MANIFEST_URL);
        resolvedUrl = manifest.url;
      }
      if (!resolvedUrl) {
        return okText({ ok: false, error: "No update URL provided or found in manifest." });
      }
      const { downloadUpdate } = await import("./updater.js");
      const destination = await downloadUpdate(resolvedUrl, nodePath.join(runtimeDir(), "updates"));
      return okText({ ok: true, downloadedTo: destination });
    } catch (error) {
      return okText({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.tool(
    "openstudio_delete_instance",
    "Delete an instance in Roblox Studio (destructive)",
    { path: z.string().min(1), confirm: z.boolean().optional() },
    async ({ path, confirm }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      if (!confirm) {
        return okText({ ok: false, error: "Pass confirm: true to delete an instance." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "delete_instance", { path });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_rename_instance",
    "Rename an instance in Roblox Studio",
    { path: z.string().min(1), newName: z.string().min(1) },
    async ({ path, newName }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "rename_instance", { path, newName });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_search_instances",
    "Search instances by name and/or class name under a root",
    {
      root: z.string().optional(),
      name: z.string().optional(),
      className: z.string().optional(),
      maxResults: z.number().int().min(1).max(1000).optional(),
      maxNodes: z.number().int().min(1).max(5000).optional(),
    },
    async ({ root, name, className, maxResults, maxNodes }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "search_instances", {
        root: root ?? "game",
        name: name ?? null,
        className: className ?? null,
        maxResults: maxResults ?? 100,
        maxNodes: maxNodes ?? 5000,
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_inspect_instance",
    "Inspect an instance, returning its path, class, parent, children, and a best-effort property dump",
    { path: z.string().min(1) },
    async ({ path }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "inspect_instance", { path });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_set_permission_level",
    "Set bridge permission level at runtime",
    { level: z.enum(["read-only", "scripts-only", "full-edit"]) },
    async ({ level }) => {
      const changed = state.setPermissionLevel(level);
      return okText({ ok: changed, permissionLevel: state.permissionLevel });
    },
  );


  server.tool(
    "openstudio_studio_ui",
    "Build Roblox UI in Studio from a node tree (StudioUI). The node may contain className/name, properties (array of {name,type,value}), props (simple object), and children.",
    {
      parentPath: z.string().optional(),
      node: uiNodeSchema,
    },
    async ({ parentPath, node }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      if (!node || typeof node !== "object") {
        return okText({ ok: false, error: "A node object is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_create_ui",
    "Build Roblox UI in Studio from a node tree (StudioUI). The node may contain className/name, properties (array of {name,type,value}), props (simple object), and children.",
    {
      parentPath: z.string().optional(),
      node: uiNodeSchema,
    },
    async ({ parentPath, node }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      if (!node || typeof node !== "object") {
        return okText({ ok: false, error: "A node object is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_import_ui",
    "Build Roblox UI in Studio from a node tree (StudioUI). The node may contain className/name, properties (array of {name,type,value}), props (simple object), and children.",
    {
      parentPath: z.string().optional(),
      node: uiNodeSchema,
    },
    async ({ parentPath, node }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      if (!node || typeof node !== "object") {
        return okText({ ok: false, error: "A node object is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_build_ui",
    "Build Roblox UI in Studio from a node tree (StudioUI). The node may contain className/name, properties (array of {name,type,value}), props (simple object), and children.",
    {
      parentPath: z.string().optional(),
      node: uiNodeSchema,
    },
    async ({ parentPath, node }) => {
      if (!state.hasPermission("full-edit")) {
        return permissionError("full-edit");
      }
      if (!node || typeof node !== "object") {
        return okText({ ok: false, error: "A node object is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );

  
  server.tool(
    "openstudio_capture_screen",
    "Capture a screenshot of the Roblox Studio window (Windows). Returns the PNG file path and an embedded image.",
    {
      outputPath: z.string().optional(),
      windowTitle: z.string().optional(),
      wholeScreen: z.boolean().optional(),
    },
    async ({ outputPath, windowTitle, wholeScreen }) => {
      if (process.platform !== "win32") {
        return okText({ ok: false, error: "Screen capture is currently supported on Windows only." });
      }
      try {
        const screenshotDir = nodePath.join(runtimeDir(), "screenshots");
        fs.mkdirSync(screenshotDir, { recursive: true });
        const destination = outputPath
          ? nodePath.resolve(outputPath)
          : nodePath.join(screenshotDir, "studio-" + Date.now() + ".png");
        const scriptPath = nodePath.join(screenshotDir, "capture.ps1");
        const script = [
          'param([string]$Destination, [string]$WindowTitle, [string]$WholeScreenFlag)',
          'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
          "Add-Type -TypeDefinition @'",
          'using System;',
          'using System.Runtime.InteropServices;',
          'public class NativeWin {',
          '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }',
          '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
          '}',
          "'@",
          'if ($WholeScreenFlag -eq "1") {',
          '  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
          '  $x = $bounds.X; $y = $bounds.Y; $w = $bounds.Width; $h = $bounds.Height',
          '} else {',
          '  $proc = $null',
          '  try { $proc = Get-Process -Name "RobloxStudioBeta" -ErrorAction Stop | Select-Object -First 1 } catch { }',
          '  if (-not $proc) { $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*Studio*" } | Select-Object -First 1 }',
          '  if (-not $proc) { throw "Roblox Studio window not found" }',
          '  $r = New-Object NativeWin+RECT',
          '  [NativeWin]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null',
          '  $x = $r.Left; $y = $r.Top; $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top',
          '  if ($w -le 0 -or $h -le 0) { throw "Studio window is not visible" }',
          '}',
          '$bmp = New-Object System.Drawing.Bitmap($w, $h)',
          '$g = [System.Drawing.Graphics]::FromImage($bmp)',
          '$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)',
          '$bmp.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)',
          '$g.Dispose()',
          '$bmp.Dispose()',
        ].join("\n");
        fs.writeFileSync(scriptPath, script, "utf8");
        const { execFileSync } = await import("node:child_process");
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-Destination",
            destination,
            "-WindowTitle",
            windowTitle ?? "Roblox Studio",
            "-WholeScreenFlag",
            wholeScreen ? "1" : "0",
          ],
          { timeout: 20000, windowsHide: true },
        );
        const buffer = fs.readFileSync(destination);
        const base64 = buffer.toString("base64");
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ ok: true, path: destination, bytes: buffer.length }, null, 2) },
            { type: "image" as const, data: base64, mimeType: "image/png" as const },
          ],
        };
      } catch (error) {
        return okText({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  );


  server.tool(
    "openstudio_test",
    "Run a read-only structural test of the game: compiles scripts and reports UI/code issues.",
    {
      root: z.string().optional(),
      maxNodes: z.number().int().min(1).max(10000).optional(),
      maxScripts: z.number().int().min(1).max(1000).optional(),
    },
    async ({ root, maxNodes, maxScripts }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "test_game", {
        root: root ?? "game",
        maxNodes: maxNodes ?? 3000,
        maxScripts: maxScripts ?? 200,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_test_game",
    "Run a read-only structural test of the game: compiles scripts and reports UI/code issues.",
    {
      root: z.string().optional(),
      maxNodes: z.number().int().min(1).max(10000).optional(),
      maxScripts: z.number().int().min(1).max(1000).optional(),
    },
    async ({ root, maxNodes, maxScripts }) => {
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "test_game", {
        root: root ?? "game",
        maxNodes: maxNodes ?? 3000,
        maxScripts: maxScripts ?? 200,
      });
      return okText(result);
    },
  );


  function uiColorTuple(hexOrCsv?: string, fallback = "0.2,0.2,0.2") {
    return hexOrCsv && hexOrCsv.trim() ? hexOrCsv.trim() : fallback;
  }

  server.tool(
    "openstudio_ui_panel",
    "Create a styled UI panel (Frame) with optional title.",
    {
      parentPath: z.string().optional(),
      name: z.string().optional(),
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
      background: z.string().optional(),
      title: z.string().optional(),
    },
    async ({ parentPath, name, width, height, background, title }) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const w = width ?? 320;
      const h = height ?? 240;
      const bg = uiColorTuple(background, "0.16,0.16,0.18");
      const panelName = name ?? "Panel";
      const children: any[] = [];
      if (title) {
        children.push({
          name: title + "Title",
          className: "TextLabel",
          properties: [
            { name: "Size", type: "UDim2", value: "1,0,0,36" },
            { name: "BackgroundTransparency", type: "number", value: "1" },
            { name: "Text", type: "string", value: title },
            { name: "TextColor3", type: "Color3", value: "1,1,1" },
            { name: "TextScaled", type: "boolean", value: "true" },
          ],
        });
      }
      children.push({
        name: "UIPadding",
        className: "UIPadding",
        properties: [
          { name: "PaddingLeft", type: "UDim", value: "0,12" },
          { name: "PaddingRight", type: "UDim", value: "0,12" },
          { name: "PaddingTop", type: "UDim", value: "0,12" },
          { name: "PaddingBottom", type: "UDim", value: "0,12" },
        ],
      });
      children.push({
        name: "UICorner",
        className: "UICorner",
        properties: [{ name: "CornerRadius", type: "UDim", value: "0,12" }],
      });
      const node = {
        name: panelName,
        className: "Frame",
        properties: [
          { name: "Size", type: "UDim2", value: "0," + w + ",0," + h },
          { name: "Position", type: "UDim2", value: "0.5,0,0.5,0" },
          { name: "AnchorPoint", type: "Vector2", value: "0.5,0.5" },
          { name: "BackgroundColor3", type: "Color3", value: bg },
          { name: "BorderSizePixel", type: "number", value: "0" },
        ],
        children,
      };
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_ui_button",
    "Create a clickable-looking UI button.",
    {
      parentPath: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
      background: z.string().optional(),
      textColor: z.string().optional(),
    },
    async ({ parentPath, name, text, width, height, background, textColor }) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const w = width ?? 180;
      const h = height ?? 48;
      const bg = uiColorTuple(background, "0.2,0.45,0.9");
      const fg = uiColorTuple(textColor, "1,1,1");
      const buttonName = name ?? "Button";
      const node = {
        name: buttonName,
        className: "TextButton",
        properties: [
          { name: "Size", type: "UDim2", value: "0," + w + ",0," + h },
          { name: "BackgroundColor3", type: "Color3", value: bg },
          { name: "Text", type: "string", value: text ?? "Button" },
          { name: "TextColor3", type: "Color3", value: fg },
          { name: "TextScaled", type: "boolean", value: "true" },
          { name: "BorderSizePixel", type: "number", value: "0" },
          { name: "AutoButtonColor", type: "boolean", value: "true" },
        ],
        children: [
          {
            name: "UICorner",
            className: "UICorner",
            properties: [{ name: "CornerRadius", type: "UDim", value: "0,8" }],
          },
        ],
      };
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );

  server.tool(
    "openstudio_ui_list",
    "Create a list container (ScrollingFrame with UIListLayout).",
    {
      parentPath: z.string().optional(),
      name: z.string().optional(),
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
      fillDirection: z.enum(["Vertical", "Horizontal"]).optional(),
      padding: z.number().int().min(0).max(64).optional(),
    },
    async ({ parentPath, name, width, height, fillDirection, padding }) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const w = width ?? 300;
      const h = height ?? 400;
      const pad = padding ?? 8;
      const dir = fillDirection ?? "Vertical";
      const node = {
        name: name ?? "List",
        className: "ScrollingFrame",
        properties: [
          { name: "Size", type: "UDim2", value: "0," + w + ",0," + h },
          { name: "CanvasSize", type: "UDim2", value: "0,0,0,0" },
          { name: "AutomaticCanvasSize", type: "EnumItem", value: dir === "Vertical" ? "Enum.AutomaticSize.Y" : "Enum.AutomaticSize.X" },
          { name: "ScrollBarThickness", type: "number", value: "6" },
          { name: "BorderSizePixel", type: "number", value: "0" },
          { name: "BackgroundColor3", type: "Color3", value: "0.12,0.12,0.12" },
        ],
        children: [
          {
            name: "UIListLayout",
            className: "UIListLayout",
            properties: [
              { name: "FillDirection", type: "EnumItem", value: "Enum.FillDirection." + dir },
              { name: "Padding", type: "UDim", value: "0," + pad },
              { name: "SortOrder", type: "EnumItem", value: "Enum.SortOrder.LayoutOrder" },
            ],
          },
          {
            name: "UIPadding",
            className: "UIPadding",
            properties: [
              { name: "PaddingLeft", type: "UDim", value: "0," + pad },
              { name: "PaddingRight", type: "UDim", value: "0," + pad },
              { name: "PaddingTop", type: "UDim", value: "0," + pad },
              { name: "PaddingBottom", type: "UDim", value: "0," + pad },
            ],
          },
        ],
      };
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_ui_card",
    "Create a polished card/panel with title and body.",
    { parentPath: z.string().optional(), name: z.string().optional(), title: z.string().optional(), body: z.string().optional(), width: z.number().int().min(1).max(4096).optional(), height: z.number().int().min(1).max(4096).optional(), background: z.string().optional() },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = ((p: any) => ({
  name: p.name ?? "Card",
  className: "Frame",
  properties: [
    { name: "Size", type: "UDim2", value: "0," + (p.width ?? 360) + ",0," + (p.height ?? 160) },
    { name: "Position", type: "UDim2", value: "0.5,0,0.5,0" },
    { name: "AnchorPoint", type: "Vector2", value: "0.5,0.5" },
    { name: "BackgroundColor3", type: "Color3", value: uiColorTuple(p.background, "0.16,0.16,0.18") },
    { name: "BorderSizePixel", type: "number", value: "0" },
  ],
  children: [
    { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,14" }] },
    { name: "UIStroke", className: "UIStroke", properties: [{ name: "Color", type: "Color3", value: "0.35,0.35,0.38" }, { name: "Thickness", type: "number", value: "1" }] },
    ...(p.title ? [{ name: "Title", className: "TextLabel", properties: [
      { name: "Size", type: "UDim2", value: "1,-24,0,30" },
      { name: "Position", type: "UDim2", value: "0,12,0,10" },
      { name: "BackgroundTransparency", type: "number", value: "1" },
      { name: "Text", type: "string", value: p.title },
      { name: "TextColor3", type: "Color3", value: "1,1,1" },
      { name: "TextScaled", type: "boolean", value: "true" },
      { name: "TextXAlignment", type: "EnumItem", value: "Enum.TextXAlignment.Left" },
    ] }] : []),
    ...(p.body ? [{ name: "Body", className: "TextLabel", properties: [
      { name: "Size", type: "UDim2", value: "1,-24,1,-46" },
      { name: "Position", type: "UDim2", value: "0,12,0,42" },
      { name: "BackgroundTransparency", type: "number", value: "1" },
      { name: "Text", type: "string", value: p.body },
      { name: "TextColor3", type: "Color3", value: "0.82,0.82,0.86" },
      { name: "TextWrapped", type: "boolean", value: "true" },
      { name: "TextScaled", type: "boolean", value: "false" },
      { name: "TextXAlignment", type: "EnumItem", value: "Enum.TextXAlignment.Left" },
      { name: "TextYAlignment", type: "EnumItem", value: "Enum.TextYAlignment.Top" },
    ] }] : []),
  ],
}))(params);
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_ui_button",
    "Create a glossy UI button with corner radius.",
    { parentPath: z.string().optional(), name: z.string().optional(), text: z.string().optional(), width: z.number().int().min(1).max(4096).optional(), height: z.number().int().min(1).max(4096).optional(), background: z.string().optional() },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = ((p: any) => ({
  name: p.name ?? "Button",
  className: "TextButton",
  properties: [
    { name: "Size", type: "UDim2", value: "0," + (p.width ?? 180) + ",0," + (p.height ?? 46) },
    { name: "BackgroundColor3", type: "Color3", value: uiColorTuple(p.background, "0.24,0.5,0.98") },
    { name: "Text", type: "string", value: p.text ?? "Button" },
    { name: "TextColor3", type: "Color3", value: "1,1,1" },
    { name: "TextScaled", type: "boolean", value: "true" },
    { name: "BorderSizePixel", type: "number", value: "0" },
    { name: "AutoButtonColor", type: "boolean", value: "true" },
    { name: "Font", type: "EnumItem", value: "Enum.Font.GothamBold" },
  ],
  children: [
    { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,10" }] },
    { name: "UIStroke", className: "UIStroke", properties: [{ name: "Color", type: "Color3", value: "1,1,1" }, { name: "Thickness", type: "number", value: "0" }, { name: "Transparency", type: "number", value: "0.7" }] },
    { name: "UIScale", className: "UIScale", properties: [{ name: "Scale", type: "number", value: "1" }] },
  ],
}))(params);
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_ui_toggle",
    "Create a polished toggle (visual only; wire events separately).",
    { parentPath: z.string().optional(), name: z.string().optional(), text: z.string().optional(), checked: z.boolean().optional() },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = ((p: any) => ({
  name: p.name ?? "Toggle",
  className: "Frame",
  properties: [
    { name: "Size", type: "UDim2", value: "0,220,0,36" },
    { name: "BackgroundTransparency", type: "number", value: "1" },
  ],
  children: [
    { name: "Label", className: "TextLabel", properties: [
      { name: "Size", type: "UDim2", value: "1,-52,1,0" },
      { name: "BackgroundTransparency", type: "number", value: "1" },
      { name: "Text", type: "string", value: p.text ?? "Toggle" },
      { name: "TextColor3", type: "Color3", value: "1,1,1" },
      { name: "TextXAlignment", type: "EnumItem", value: "Enum.TextXAlignment.Left" },
      { name: "TextScaled", type: "boolean", value: "true" },
    ] },
    { name: "Track", className: "Frame", properties: [
      { name: "Size", type: "UDim2", value: "0,44,0,24" },
      { name: "Position", type: "UDim2", value: "1,-44,0.5,0" },
      { name: "AnchorPoint", type: "Vector2", value: "0,0.5" },
      { name: "BackgroundColor3", type: "Color3", value: p.checked ? "0.25,0.75,0.4" : "0.35,0.35,0.38" },
      { name: "BorderSizePixel", type: "number", value: "0" },
    ], children: [
      { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,999" }] },
      { name: "Knob", className: "Frame", properties: [
        { name: "Size", type: "UDim2", value: "0,18,0,18" },
        { name: "Position", type: "UDim2", value: p.checked ? "1,-2,0.5,0" : "0,2,0.5,0" },
        { name: "AnchorPoint", type: "Vector2", value: p.checked ? "1,0.5" : "0,0.5" },
        { name: "BackgroundColor3", type: "Color3", value: "1,1,1" },
        { name: "BorderSizePixel", type: "number", value: "0" },
      ], children: [
        { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,999" }] },
      ] },
    ] },
  ],
}))(params);
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_ui_tabbar",
    "Create a horizontal tab bar with tabs.",
    { parentPath: z.string().optional(), name: z.string().optional(), tabs: z.array(z.string()).min(1).max(12).optional(), width: z.number().int().min(1).max(4096).optional() },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = ((p: any) => {
  const tabs = p.tabs ?? ["Tab 1", "Tab 2", "Tab 3"];
  return {
    name: p.name ?? "TabBar",
    className: "Frame",
    properties: [
      { name: "Size", type: "UDim2", value: "0," + (p.width ?? 360) + ",0,40" },
      { name: "BackgroundColor3", type: "Color3", value: "0.12,0.12,0.14" },
      { name: "BorderSizePixel", type: "number", value: "0" },
    ],
    children: [
      { name: "UIListLayout", className: "UIListLayout", properties: [
        { name: "FillDirection", type: "EnumItem", value: "Enum.FillDirection.Horizontal" },
        { name: "Padding", type: "UDim", value: "0,6" },
        { name: "SortOrder", type: "EnumItem", value: "Enum.SortOrder.LayoutOrder" },
      ] },
      { name: "UIPadding", className: "UIPadding", properties: [
        { name: "PaddingLeft", type: "UDim", value: "0,6" },
        { name: "PaddingTop", type: "UDim", value: "0,4" },
        { name: "PaddingBottom", type: "UDim", value: "0,4" },
      ] },
      ...tabs.map((t: string, i: number) => ({
        name: "Tab" + (i + 1),
        className: "TextButton",
        properties: [
          { name: "Size", type: "UDim2", value: "0,0,1,0" },
          { name: "AutomaticSize", type: "EnumItem", value: "Enum.AutomaticSize.X" },
          { name: "BackgroundColor3", type: "Color3", value: i === 0 ? "0.28,0.55,0.98" : "0.2,0.2,0.22" },
          { name: "Text", type: "string", value: t },
          { name: "TextColor3", type: "Color3", value: "1,1,1" },
          { name: "TextScaled", type: "boolean", value: "true" },
          { name: "BorderSizePixel", type: "number", value: "0" },
        ],
        children: [{ name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,8" }] }],
      })),
    ],
  };
})(params);
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_ui_toast",
    "Create a toast notification widget.",
    { parentPath: z.string().optional(), name: z.string().optional(), text: z.string().optional(), type: z.enum(["info", "success", "warning", "error"]).optional() },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = ((p: any) => {
  const tones: any = { info: "0.2,0.45,0.95", success: "0.2,0.72,0.35", warning: "0.95,0.7,0.2", error: "0.9,0.25,0.25" };
  const tone = tones[p.type ?? "info"];
  return {
    name: p.name ?? "Toast",
    className: "Frame",
    properties: [
      { name: "Size", type: "UDim2", value: "0,320,0,48" },
      { name: "Position", type: "UDim2", value: "0.5,0,1,0" },
      { name: "AnchorPoint", type: "Vector2", value: "0.5,1" },
      { name: "BackgroundColor3", type: "Color3", value: tone },
      { name: "BorderSizePixel", type: "number", value: "0" },
    ],
    children: [
      { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,10" }] },
      { name: "UIStroke", className: "UIStroke", properties: [{ name: "Color", type: "Color3", value: "1,1,1" }, { name: "Thickness", type: "number", value: "0" }, { name: "Transparency", type: "number", value: "0.7" }] },
      { name: "Message", className: "TextLabel", properties: [
        { name: "Size", type: "UDim2", value: "1,-16,1,0" },
        { name: "Position", type: "UDim2", value: "0,8,0,0" },
        { name: "BackgroundTransparency", type: "number", value: "1" },
        { name: "Text", type: "string", value: p.text ?? "Notification" },
        { name: "TextColor3", type: "Color3", value: "1,1,1" },
        { name: "TextScaled", type: "boolean", value: "true" },
      ] },
    ],
  };
})(params);
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );



  server.tool(
    "openstudio_runtime_status",
    "Report whether Studio is currently in run/play mode and return recent buffered output.",
    {},
    async () => {
      try {
        const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "execute_lua", {
          code: "local rs = game:GetService('RunService'); return 'runMode=' .. tostring(rs:IsRunMode()) .. '; studio=' .. tostring(rs:IsStudio()) .. '; client=' .. tostring(rs:IsClient()) .. '; server=' .. tostring(rs:IsServer())",
        });
        const logs = state.drainLogs();
        return okText({ ok: true, runtime: result, recentLogs: logs.slice(-25) });
      } catch (error) {
        return okText({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.tool(
    "openstudio_runtime_assert",
    "Run a Luau assertion/check in the Studio plugin context and report pass/fail with logs.",
    {
      code: z.string().min(1),
      confirm: z.boolean().optional(),
    },
    async ({ code, confirm }) => {
      if (!confirm) {
        return okText({ ok: false, error: "Pass confirm: true to run a runtime assertion." });
      }
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      try {
        const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "execute_lua", { code });
        const logs = state.drainLogs();
        const passed = Boolean(result && (result as any).ok);
        return okText({ ok: passed, result, recentLogs: logs.slice(-25) });
      } catch (error) {
        return okText({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  );


  server.tool(
    "openstudio_ui_button_animated",
    "Create a button with hover/press size animation.",
    {
      parentPath: z.string().optional(),
      name: z.string().optional(),
      text: z.string().optional(),
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
    },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = {
  name: params.name ?? "AnimatedButton",
  className: "TextButton",
  properties: [
    { name: "Size", type: "UDim2", value: "0," + (params.width ?? 190) + ",0," + (params.height ?? 48) },
    { name: "BackgroundColor3", type: "Color3", value: "0.24,0.5,0.98" },
    { name: "Text", type: "string", value: params.text ?? "Button" },
    { name: "TextColor3", type: "Color3", value: "1,1,1" },
    { name: "TextScaled", type: "boolean", value: "true" },
    { name: "BorderSizePixel", type: "number", value: "0" },
    { name: "Font", type: "EnumItem", value: "Enum.Font.GothamBold" },
  ],
  children: [
    { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,10" }] },
    { name: "HoverAnimator", className: "LocalScript", properties: [
      { name: "Source", type: "string", value: "local button = script.Parent\nlocal ts = game:GetService(\"TweenService\")\nlocal baseSize = button.Size\nlocal hoverTween = ts:Create(button, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {Size = baseSize + UDim2.fromOffset(6, 6)})\nlocal leaveTween = ts:Create(button, TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {Size = baseSize})\nbutton.MouseEnter:Connect(function() hoverTween:Play() end)\nbutton.MouseLeave:Connect(function() leaveTween:Play() end)\n" },
    ] },
  ],
};
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_model",
    "Generate a 3D model/part assembly in Studio from a structured object description.",
    { parentPath: z.string().optional(), modelName: z.string().optional(), scale: z.number().optional(), objects: z.array(modelObjectSchema).optional(), filePath: z.string().optional(), scene: z.any().optional() },
    async ({ parentPath, modelName, scale, objects, filePath, scene }) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      let resolvedObjects = objects;
      let resolvedScale = scale ?? 1;
      if (filePath || scene) {
        if (filePath && !fs.existsSync(filePath)) {
          return okText({ ok: false, error: "Blender scene file not found." });
        }
        let resolvedScene = scene;
        if (filePath) {
          try { resolvedScene = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) {
            return okText({ ok: false, error: "Invalid JSON in Blender scene file." });
          }
        }
        if (!resolvedScene || !Array.isArray(resolvedScene.objects)) {
          return okText({ ok: false, error: "Scene must contain an objects array." });
        }
        resolvedObjects = resolvedScene.objects;
        resolvedScale = scale ?? resolvedScene.scale ?? 1;
      }
      if (!Array.isArray(resolvedObjects) || resolvedObjects.length === 0) {
        return okText({ ok: false, error: "A non-empty objects array (or filePath/scene) is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_model", {
        parentPath: parentPath ?? "game.Workspace",
        modelName: modelName ?? "GeneratedModel",
        scale: resolvedScale,
        objects: resolvedObjects,
      })
      return okText(result);
    },
  );


  server.tool(
    "openstudio_generate_model",
    "Generate a 3D model/part assembly in Studio from a structured object description.",
    { parentPath: z.string().optional(), modelName: z.string().optional(), scale: z.number().optional(), objects: z.array(modelObjectSchema).optional(), filePath: z.string().optional(), scene: z.any().optional() },
    async ({ parentPath, modelName, scale, objects, filePath, scene }) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      let resolvedObjects = objects;
      let resolvedScale = scale ?? 1;
      if (filePath || scene) {
        if (filePath && !fs.existsSync(filePath)) {
          return okText({ ok: false, error: "Blender scene file not found." });
        }
        let resolvedScene = scene;
        if (filePath) {
          try { resolvedScene = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) {
            return okText({ ok: false, error: "Invalid JSON in Blender scene file." });
          }
        }
        if (!resolvedScene || !Array.isArray(resolvedScene.objects)) {
          return okText({ ok: false, error: "Scene must contain an objects array." });
        }
        resolvedObjects = resolvedScene.objects;
        resolvedScale = scale ?? resolvedScene.scale ?? 1;
      }
      if (!Array.isArray(resolvedObjects) || resolvedObjects.length === 0) {
        return okText({ ok: false, error: "A non-empty objects array (or filePath/scene) is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_model", {
        parentPath: parentPath ?? "game.Workspace",
        modelName: modelName ?? "GeneratedModel",
        scale: resolvedScale,
        objects: resolvedObjects,
      })
      return okText(result);
    },
  );


  server.tool(
    "openstudio_build_model",
    "Generate a 3D model/part assembly in Studio from a structured object description.",
    { parentPath: z.string().optional(), modelName: z.string().optional(), scale: z.number().optional(), objects: z.array(modelObjectSchema).optional(), filePath: z.string().optional(), scene: z.any().optional() },
    async ({ parentPath, modelName, scale, objects, filePath, scene }) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      let resolvedObjects = objects;
      let resolvedScale = scale ?? 1;
      if (filePath || scene) {
        if (filePath && !fs.existsSync(filePath)) {
          return okText({ ok: false, error: "Blender scene file not found." });
        }
        let resolvedScene = scene;
        if (filePath) {
          try { resolvedScene = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) {
            return okText({ ok: false, error: "Invalid JSON in Blender scene file." });
          }
        }
        if (!resolvedScene || !Array.isArray(resolvedScene.objects)) {
          return okText({ ok: false, error: "Scene must contain an objects array." });
        }
        resolvedObjects = resolvedScene.objects;
        resolvedScale = scale ?? resolvedScene.scale ?? 1;
      }
      if (!Array.isArray(resolvedObjects) || resolvedObjects.length === 0) {
        return okText({ ok: false, error: "A non-empty objects array (or filePath/scene) is required." });
      }
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_model", {
        parentPath: parentPath ?? "game.Workspace",
        modelName: modelName ?? "GeneratedModel",
        scale: resolvedScale,
        objects: resolvedObjects,
      })
      return okText(result);
    },
  );


  server.tool(
    "openstudio_game_checkup",
    "Run a combined structural + runtime diagnostic of the open place.",
    {
      root: z.string().optional(),
      maxNodes: z.number().int().min(1).max(10000).optional(),
      maxScripts: z.number().int().min(1).max(1000).optional(),
    },
    async ({ root, maxNodes, maxScripts }) => {
      if (!state.hasPermission("read-only")) return permissionError("read-only");
      try {
        const structural = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "test_game", {
          root: root ?? "game",
          maxNodes: maxNodes ?? 3000,
          maxScripts: maxScripts ?? 200,
        });
        let runtime = null;
        try {
          runtime = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "execute_lua", {
            code: "local rs = game:GetService('RunService'); return 'runMode=' .. tostring(rs:IsRunMode()) .. '; client=' .. tostring(rs:IsClient()) .. '; server=' .. tostring(rs:IsServer())",
          });
        } catch (error) {
          runtime = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        const logs = state.drainLogs();
        const result = {
          ok: Boolean(structural && (structural as any).ok),
          structural,
          runtime,
          recentLogs: logs.slice(-30),
          summary: {
            instanceCount: (structural as any)?.data?.instanceCount ?? null,
            scriptCount: (structural as any)?.data?.scriptCount ?? null,
            compileErrorCount: (structural as any)?.data?.compileErrorCount ?? null,
            uiIssueCount: (structural as any)?.data?.uiIssueCount ?? null,
            logsCaptured: logs.length,
          },
        };
        return okText(result);
      } catch (error) {
        return okText({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  );

  server.tool(
    "openstudio_collect_diagnostics",
    "Collect bridge, Studio, permission, queue, and buffered log diagnostics.",
    {},
    async () => {
      const logs = state.drainLogs();
      return okText({
        ok: true,
        bridgeVersion: BRIDGE_VERSION,
        studioConnected: state.isStudioConnected(HEARTBEAT_STALE_MS),
        connection: state.connection
          ? { clientId: state.connection.clientId, version: state.connection.version, gameName: state.connection.gameName, placeId: state.connection.placeId, lastHeartbeat: state.connection.lastHeartbeat }
          : null,
        permissionLevel: state.permissionLevel,
        pendingCommands: state.pendingCount(),
        queuedCommands: state.queueSize(),
        bufferedLogs: logs.length,
        recentLogs: logs.slice(-25),
      });
    },
  );


  server.tool(
    "openstudio_ui_tabs",
    "Create a tabbed UI with clickable tabs and swappable content panels.",
    {
      parentPath: z.string().optional(),
      name: z.string().optional(),
      tabs: z.array(z.string()).min(1).max(12),
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
    },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const labels = params.tabs;
      const tabNames = labels.map((_: string, i: number) => "Tab" + (i + 1));
      const panelNames = labels.map((_: string, i: number) => "Panel" + (i + 1));
      const w = params.width ?? 420;
      const h = params.height ?? 280;
      const tabButtons = labels.map((label: string, i: number) => ({
        name: tabNames[i],
        className: "TextButton",
        properties: [
          { name: "Size", type: "UDim2", value: "0,0,1,0" },
          { name: "AutomaticSize", type: "EnumItem", value: "Enum.AutomaticSize.X" },
          { name: "BackgroundColor3", type: "Color3", value: i === 0 ? "0.28,0.55,0.98" : "0.2,0.2,0.22" },
          { name: "Text", type: "string", value: label },
          { name: "TextColor3", type: "Color3", value: "1,1,1" },
          { name: "TextScaled", type: "boolean", value: "true" },
          { name: "BorderSizePixel", type: "number", value: "0" },
        ],
        children: [{ name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,8" }] }],
      }));
      const panels = labels.map((label: string, i: number) => ({
        name: panelNames[i],
        className: "Frame",
        properties: [
          { name: "Size", type: "UDim2", value: "1,0,1,-48" },
          { name: "Position", type: "UDim2", value: "0,0,0,48" },
          { name: "BackgroundColor3", type: "Color3", value: "0.14,0.14,0.16" },
          { name: "Visible", type: "boolean", value: i === 0 ? "true" : "false" },
          { name: "BorderSizePixel", type: "number", value: "0" },
        ],
        children: [
          { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,12" }] },
          { name: "Title", className: "TextLabel", properties: [
            { name: "Size", type: "UDim2", value: "1,-20,0,34" },
            { name: "Position", type: "UDim2", value: "0,10,0,10" },
            { name: "BackgroundTransparency", type: "number", value: "1" },
            { name: "Text", type: "string", value: label },
            { name: "TextColor3", type: "Color3", value: "1,1,1" },
            { name: "TextXAlignment", type: "EnumItem", value: "Enum.TextXAlignment.Left" },
            { name: "TextScaled", type: "boolean", value: "true" },
          ] },
        ],
      }));
      const tabsJson = JSON.stringify(tabNames);
      const panelsJson = JSON.stringify(panelNames);
      const script = [
        "local container = script.Parent",
        'local tabBar = container:WaitForChild("TabBar")',
        'local content = container:WaitForChild("Content")',
        "local tabNames = " + tabsJson,
        "local panelNames = " + panelsJson,
        "local tabs = {}",
        "local panels = {}",
        "for _, name in ipairs(tabNames) do tabs[name] = tabBar:WaitForChild(name) end",
        "for _, name in ipairs(panelNames) do panels[name] = content:WaitForChild(name) end",
        "local function select(i)",
        "  for n = 1, #tabNames do",
        "    tabs[tabNames[n]].BackgroundColor3 = (n == i) and Color3.fromRGB(72,140,250) or Color3.fromRGB(52,52,56)",
        "    panels[panelNames[n]].Visible = (n == i)",
        "  end",
        "end",
        "for n = 1, #tabNames do",
        "  local i = n",
        "  tabs[tabNames[n]].MouseButton1Click:Connect(function() select(i) end)",
        "end",
        "select(1)",
      ].join("\n");
      const node = {
        name: params.name ?? "Tabs",
        className: "Frame",
        properties: [
          { name: "Size", type: "UDim2", value: "0," + w + ",0," + h },
          { name: "BackgroundColor3", type: "Color3", value: "0.12,0.12,0.14" },
          { name: "BorderSizePixel", type: "number", value: "0" },
        ],
        children: [
          {
            name: "TabBar",
            className: "Frame",
            properties: [
              { name: "Size", type: "UDim2", value: "1,0,0,44" },
              { name: "BackgroundTransparency", type: "number", value: "1" },
            ],
            children: [
              { name: "UIListLayout", className: "UIListLayout", properties: [
                { name: "FillDirection", type: "EnumItem", value: "Enum.FillDirection.Horizontal" },
                { name: "Padding", type: "UDim", value: "0,6" },
                { name: "SortOrder", type: "EnumItem", value: "Enum.SortOrder.LayoutOrder" },
              ] },
              { name: "UIPadding", className: "UIPadding", properties: [
                { name: "PaddingLeft", type: "UDim", value: "0,8" },
                { name: "PaddingTop", type: "UDim", value: "0,6" },
              ] },
              ...tabButtons,
            ],
          },
          {
            name: "Content",
            className: "Frame",
            properties: [
              { name: "Size", type: "UDim2", value: "1,0,1,-44" },
              { name: "Position", type: "UDim2", value: "0,0,0,44" },
              { name: "BackgroundTransparency", type: "number", value: "1" },
            ],
            children: panels,
          },
          {
            name: "TabController",
            className: "LocalScript",
            properties: [{ name: "Source", type: "string", value: script }],
          },
        ],
      };
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );


  server.tool(
    "openstudio_ui_modal",
    "Create an animated modal with overlay and close button.",
    {
      parentPath: z.string().optional(),
      name: z.string().optional(),
      title: z.string().optional(),
      width: z.number().int().min(1).max(4096).optional(),
      height: z.number().int().min(1).max(4096).optional(),
      dimBackground: z.boolean().optional(),
    },
    async (params: any) => {
      if (!state.hasPermission("full-edit")) return permissionError("full-edit");
      const node = {
        name: params.name ?? "Modal",
        className: "ScreenGui",
        properties: [{ name: "ResetOnSpawn", type: "boolean", value: "false" }],
        children: [
          {
            name: "Overlay",
            className: "Frame",
            properties: [
              { name: "Size", type: "UDim2", value: "1,0,1,0" },
              { name: "BackgroundColor3", type: "Color3", value: "0,0,0" },
              { name: "BackgroundTransparency", type: "number", value: params.dimBackground === false ? "1" : "0.5" },
              { name: "BorderSizePixel", type: "number", value: "0" },
              { name: "ZIndex", type: "number", value: "0" },
            ],
          },
          {
            name: "Panel",
            className: "Frame",
            properties: [
              { name: "Size", type: "UDim2", value: "0," + (params.width ?? 420) + ",0," + (params.height ?? 260) },
              { name: "Position", type: "UDim2", value: "0.5,0,0.5,0" },
              { name: "AnchorPoint", type: "Vector2", value: "0.5,0.5" },
              { name: "BackgroundColor3", type: "Color3", value: "0.14,0.14,0.16" },
              { name: "BorderSizePixel", type: "number", value: "0" },
              { name: "ZIndex", type: "number", value: "1" },
            ],
            children: [
              { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,16" }] },
              { name: "UIStroke", className: "UIStroke", properties: [{ name: "Color", type: "Color3", value: "1,1,1" }, { name: "Thickness", type: "number", value: "0" }, { name: "Transparency", type: "number", value: "0.8" }] },
              { name: "Title", className: "TextLabel", properties: [
                { name: "Size", type: "UDim2", value: "1,-48,0,36" },
                { name: "Position", type: "UDim2", value: "0,12,0,12" },
                { name: "BackgroundTransparency", type: "number", value: "1" },
                { name: "Text", type: "string", value: params.title ?? "Modal" },
                { name: "TextColor3", type: "Color3", value: "1,1,1" },
                { name: "TextScaled", type: "boolean", value: "true" },
                { name: "TextXAlignment", type: "EnumItem", value: "Enum.TextXAlignment.Left" },
              ] },
              { name: "CloseButton", className: "TextButton", properties: [
                { name: "Size", type: "UDim2", value: "0,34,0,34" },
                { name: "Position", type: "UDim2", value: "1,-44,0,10" },
                { name: "AnchorPoint", type: "Vector2", value: "1,0" },
                { name: "BackgroundColor3", type: "Color3", value: "0.2,0.2,0.22" },
                { name: "BorderSizePixel", type: "number", value: "0" },
                { name: "Text", type: "string", value: "X" },
                { name: "TextColor3", type: "Color3", value: "1,1,1" },
                { name: "TextScaled", type: "boolean", value: "true" },
              ], children: [
                { name: "UICorner", className: "UICorner", properties: [{ name: "CornerRadius", type: "UDim", value: "0,8" }] },
              ] },
            ],
          },
          {
            name: "ModalController",
            className: "LocalScript",
            properties: [{ name: "Source", type: "string", value: "local controller = script.Parent\nlocal overlay = controller:WaitForChild(\"Overlay\")\nlocal panel = controller:WaitForChild(\"Panel\")\nlocal closeButton = panel:FindFirstChild(\"CloseButton\")\nlocal ts = game:GetService(\"TweenService\")\nlocal openInfo = TweenInfo.new(0.18, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)\nlocal closeInfo = TweenInfo.new(0.14, Enum.EasingStyle.Quad, Enum.EasingDirection.In)\nlocal function setOpen(visible)\n  overlay.Visible = true\n  panel.Visible = true\n  if visible then\n    overlay.BackgroundTransparency = 1\n    ts:Create(overlay, openInfo, {BackgroundTransparency = 0.5}):Play()\n  else\n    ts:Create(overlay, closeInfo, {BackgroundTransparency = 1}):Play()\n    task.delay(0.15, function() overlay.Visible = false; panel.Visible = false end)\n  end\nend\nif closeButton then closeButton.MouseButton1Click:Connect(function() setOpen(false) end) end\nsetOpen(true)\n" }], },
        ],
      };
      const result = await sendStudioCommand(state, state.isStudioConnected.bind(state), HEARTBEAT_STALE_MS, "import_ui", {
        parentPath: params.parentPath ?? "game.StarterGui",
        node,
      });
      return okText(result);
    },
  );

}



