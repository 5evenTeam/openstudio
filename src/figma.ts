export interface FigmaProperty {
  name: string;
  type: string;
  value: string;
}

export interface FigmaBuildNode {
  name: string;
  className: string;
  properties: FigmaProperty[];
  children?: FigmaBuildNode[];
}

interface FigmaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: FigmaBoundingBox;
  children?: FigmaNode[];
  characters?: string;
  style?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    fills?: Array<{ type: string; color?: { r: number; g: number; b: number; a?: number } }>;
    textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  };
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number; a?: number }; imageRef?: string }>;
  cornerRadius?: number;
  opacity?: number;
  backgroundColor?: { r: number; g: number; b: number; a?: number };
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" | "SPACE_AROUND";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

function colorToValue(color: { r: number; g: number; b: number; a?: number }): string {
  return `${color.r.toFixed(4)},${color.g.toFixed(4)},${color.b.toFixed(4)}`;
}

function colorFill(fills: FigmaNode["fills"]): { color?: string; alpha: number } {
  const solid = fills?.find((fill) => fill.type === "SOLID" && fill.color);
  if (!solid?.color) {
    return { alpha: 1 };
  }
  return {
    color: colorToValue(solid.color),
    alpha: solid.color.a ?? 1,
  };
}

function addProp(props: FigmaProperty[], name: string, type: string, value: string): void {
  props.push({ name, type, value });
}

function normalizeSize(value: number): number {
  return Math.max(1, Math.round(value));
}

export async function fetchFigmaUiPlan(
  fileKey: string,
  nodeId: string | undefined,
  options: { maxNodes?: number; rootName?: string; token?: string } = {},
): Promise<FigmaBuildNode> {
  const token = options.token ?? process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    throw new Error("FIGMA_ACCESS_TOKEN is not set");
  }

  const maxNodes = options.maxNodes ?? 250;
  let node: FigmaNode | undefined;

  if (nodeId) {
    const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`;
    const response = await fetch(url, { headers: { "X-Figma-Token": token } });
    if (!response.ok) {
      throw new Error(`Figma API failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as { nodes?: Record<string, { document?: FigmaNode }> };
    const found = json.nodes?.[nodeId]?.document;
    if (!found) {
      throw new Error(`Figma node not found: ${nodeId}`);
    }
    node = found;
  } else {
    const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`;
    const response = await fetch(url, { headers: { "X-Figma-Token": token } });
    if (!response.ok) {
      throw new Error(`Figma API failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as { document?: FigmaNode };
    const firstPage = json.document?.children?.[0];
    const firstFrame = firstPage?.children?.[0];
    node = firstFrame ?? firstPage ?? json.document;
    if (!node) {
      throw new Error("Figma document is empty");
    }
  }

  let count = 0;

  function transform(figmaNode: FigmaNode, parentBox: FigmaBoundingBox | null, rootBox: FigmaBoundingBox): FigmaBuildNode | null {
    if (count >= maxNodes) return null;
    if (figmaNode.visible === false) return null;

    const box = figmaNode.absoluteBoundingBox;
    if (!box) return null;

    count += 1;
    const width = normalizeSize(box.width);
    const height = normalizeSize(box.height);
    const relativeX = parentBox ? Math.round(box.x - parentBox.x) : 0;
    const relativeY = parentBox ? Math.round(box.y - parentBox.y) : 0;

    const isText = figmaNode.type === "TEXT";
    const className = isText ? "TextLabel" : "Frame";
    const properties: FigmaProperty[] = [];

    addProp(properties, "Name", "string", (figmaNode.name || className).slice(0, 100));
    addProp(properties, "Size", "UDim2", `0,${width},0,${height}`);
    addProp(properties, "Position", "UDim2", `0,${relativeX},0,${relativeY}`);
    addProp(properties, "AnchorPoint", "Vector2", "0,0");
    addProp(properties, "BorderSizePixel", "number", "0");

    const fill = colorFill(figmaNode.fills ?? figmaNode.style?.fills ?? (figmaNode.backgroundColor ? [{ type: "SOLID", color: figmaNode.backgroundColor }] : undefined));
    const opacity = figmaNode.opacity ?? 1;

    if (isText) {
      addProp(properties, "BackgroundTransparency", "number", "1");
      addProp(properties, "Text", "string", figmaNode.characters ?? figmaNode.name ?? "");
      addProp(properties, "TextWrapped", "boolean", "true");
      addProp(properties, "TextScaled", "boolean", "false");
      addProp(properties, "TextXAlignment", "string", "Left");
      addProp(properties, "TextYAlignment", "string", "Center");
      if (fill.color) {
        addProp(properties, "TextColor3", "Color3", fill.color);
      }
      if (figmaNode.style?.fontSize) {
        addProp(properties, "TextSize", "number", String(Math.round(figmaNode.style.fontSize)));
      }
      addProp(properties, "Font", "EnumItem", "Enum.Font.Gotham");
    } else {
      addProp(properties, "BackgroundTransparency", "number", String(1 - (opacity * (fill.color ? 1 : 1))));
      if (fill.color) {
        addProp(properties, "BackgroundColor3", "Color3", fill.color);
      }
      if ((figmaNode.cornerRadius ?? 0) > 0) {
        // appended after main node by parent assembly? We'll add child separately below.
      }
    }

    const childNodes: FigmaBuildNode[] = [];
    let childIndex = 0;
    for (const child of figmaNode.children ?? []) {
      childIndex += 1;
      const transformed = transform(child, box, rootBox);
      if (transformed) {
        transformed.properties.push({
          name: "LayoutOrder",
          type: "number",
          value: String(childIndex),
        });
        childNodes.push(transformed);
      }
    }

    const layoutMode = figmaNode.layoutMode;
    if (!isText && (layoutMode === "HORIZONTAL" || layoutMode === "VERTICAL")) {
      const primaryAlign = figmaNode.primaryAxisAlignItems ?? "MIN";
      const counterAlign = figmaNode.counterAxisAlignItems ?? "MIN";
      const horizontalAlign =
        layoutMode === "HORIZONTAL"
          ? (primaryAlign === "CENTER" ? "Center" : primaryAlign === "MAX" ? "Right" : "Left")
          : (counterAlign === "CENTER" ? "Center" : counterAlign === "MAX" ? "Right" : "Left");
      const verticalAlign =
        layoutMode === "HORIZONTAL"
          ? (counterAlign === "CENTER" ? "Center" : counterAlign === "MAX" ? "Bottom" : "Top")
          : (primaryAlign === "CENTER" ? "Center" : primaryAlign === "MAX" ? "Bottom" : "Top");

      childNodes.push({
        name: "UIListLayout",
        className: "UIListLayout",
        properties: [
          {
            name: "FillDirection",
            type: "EnumItem",
            value: layoutMode === "HORIZONTAL" ? "Enum.FillDirection.Horizontal" : "Enum.FillDirection.Vertical",
          },
          {
            name: "Padding",
            type: "UDim",
            value: `0,${Math.round(figmaNode.itemSpacing ?? 0)}`,
          },
          { name: "HorizontalAlignment", type: "EnumItem", value: `Enum.HorizontalAlignment.${horizontalAlign}` },
          { name: "VerticalAlignment", type: "EnumItem", value: `Enum.VerticalAlignment.${verticalAlign}` },
          { name: "SortOrder", type: "EnumItem", value: "Enum.SortOrder.LayoutOrder" },
        ],
      });

      const paddingLeft = figmaNode.paddingLeft ?? 0;
      const paddingRight = figmaNode.paddingRight ?? 0;
      const paddingTop = figmaNode.paddingTop ?? 0;
      const paddingBottom = figmaNode.paddingBottom ?? 0;
      if (paddingLeft || paddingRight || paddingTop || paddingBottom) {
        childNodes.push({
          name: "UIPadding",
          className: "UIPadding",
          properties: [
            { name: "PaddingLeft", type: "UDim", value: `0,${Math.round(paddingLeft)}` },
            { name: "PaddingRight", type: "UDim", value: `0,${Math.round(paddingRight)}` },
            { name: "PaddingTop", type: "UDim", value: `0,${Math.round(paddingTop)}` },
            { name: "PaddingBottom", type: "UDim", value: `0,${Math.round(paddingBottom)}` },
          ],
        });
      }
    }

    if (!isText && (figmaNode.cornerRadius ?? 0) > 0) {
      childNodes.push({
        name: "UICorner",
        className: "UICorner",
        properties: [
          { name: "CornerRadius", type: "UDim", value: `0,${Math.round(figmaNode.cornerRadius ?? 0)}` },
        ],
      });
    }

    return {
      name: options.rootName && figmaNode === node ? options.rootName : (figmaNode.name || className),
      className,
      properties,
      children: childNodes.length ? childNodes : undefined,
    };
  }

  return transform(node, null, node.absoluteBoundingBox ?? { x: 0, y: 0, width: 0, height: 0 }) ?? {
    name: node.name || "FigmaFrame",
    className: "Frame",
    properties: [],
  };
}
