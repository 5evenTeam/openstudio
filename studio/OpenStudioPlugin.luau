--[[
OpenStudio Roblox Studio Plugin

1. Save this file as a Studio plugin script (init.server.lua? plugin script).
2. Ensure the OpenStudio bridge is running (OpenStudio.bat).
3. Set TOKEN below to match OPENSTUDIO_TOKEN if you changed it.
4. The plugin auto-connects to http://127.0.0.1:3777 and polls for commands.
]]

local HttpService = game:GetService("HttpService")

local BRIDGE_URL = "http://127.0.0.1:3777"

local Plugin = (script and script:FindFirstAncestorOfClass("Plugin")) or nil
local TOKEN = (Plugin and Plugin:GetSetting("OpenStudioToken")) or "openstudio-local-dev-token"
local pendingLogs = {}
local toolbarButton = nil

local function request(method, path, body)
    local ok, result = pcall(function()
        return HttpService:RequestAsync({
            Url = BRIDGE_URL .. path,
            Method = method,
            Headers = {
                ["Content-Type"] = "application/json",
                ["X-OpenStudio-Token"] = TOKEN,
            },
            Body = body and HttpService:JSONEncode(body) or nil,
        })
    end)
    if not ok then
        return false, tostring(result)
    end
    local decoded = nil
    if result.Body and #result.Body > 0 then
        local decodeOk, decodedValue = pcall(function()
            return HttpService:JSONDecode(result.Body)
        end)
        if decodeOk then
            decoded = decodedValue
        end
    end
    return true, decoded or result
end

local function heartbeat()
    local logsToSend = pendingLogs
    pendingLogs = {}
    return request("POST", "/heartbeat", {
        version = "0.1.1",
        capabilities = {
            "list_scripts",
            "read_script",
            "write_script",
            "create_script",
            "delete_script",
            "get_selection",
            "get_instance_tree",
            "create_instance",
            "set_property",
            "delete_instance",
            "import_figma",
            "import_blender",
            "execute_lua",
        },
        gameName = game.Name,
        gameId = game.GameId,
        placeId = game.PlaceId,
        logs = logsToSend,
    })
end

local function resolvePath(input)
    if not input or input == "" or input == "game" then
        return game
    end
    local normalized = input:gsub("^game%.", "")
    local current = game
    for segment in normalized:gmatch("[^%.]+") do
        current = current:FindFirstChild(segment)
        if not current then
            return nil, "Instance not found: " .. input
        end
    end
    return current
end

local function getPathString(instance)
    if instance == game then
        return "game"
    end
    local parts = {}
    local current = instance
    while current and current ~= game do
        table.insert(parts, 1, current.Name)
        current = current.Parent
    end
    return "game." .. table.concat(parts, ".")
end

local function collectScripts(root)
    local scripts = {}
    local function visit(instance)
        if instance:IsA("LuaSourceContainer") then
            table.insert(scripts, {
                path = getPathString(instance),
                className = instance.ClassName,
                name = instance.Name,
            })
        end
        for _, child in ipairs(instance:GetChildren()) do
            visit(child)
        end
    end
    visit(root)
    return scripts
end

local function convertPropertyValue(valueType, rawValue)
    if valueType == "string" then
        return true, rawValue
    elseif valueType == "number" then
        local numberValue = tonumber(rawValue)
        if numberValue == nil then
            return false, "Invalid number: " .. tostring(rawValue)
        end
        return true, numberValue
    elseif valueType == "boolean" then
        if rawValue == "true" then
            return true, true
        elseif rawValue == "false" then
            return true, false
        end
        return false, "Invalid boolean: " .. tostring(rawValue)
    elseif valueType == "Vector3" then
        local x, y, z = rawValue:match("([^,]+),([^,]+),([^,]+)")
        return true, Vector3.new(tonumber(x) or 0, tonumber(y) or 0, tonumber(z) or 0)
    elseif valueType == "Color3" then
        local r, g, b = rawValue:match("([^,]+),([^,]+),([^,]+)")
        return true, Color3.new(tonumber(r) or 0, tonumber(g) or 0, tonumber(b) or 0)
    elseif valueType == "BrickColor" then
        local numberValue = tonumber(rawValue)
        if numberValue then
            return true, BrickColor.new(numberValue)
        end
        return true, BrickColor.new(rawValue)
    elseif valueType == "Instance" then
        local target, err = resolvePath(rawValue)
        if not target then
            return false, err
        end
        return true, target
    elseif valueType == "UDim" then
        local scale, offset = rawValue:match("([^,]+),([^,]+)")
        return true, UDim.new(tonumber(scale) or 0, tonumber(offset) or 0)
    elseif valueType == "UDim2" then
        local sx, ox, sy, oy = rawValue:match("([^,]+),([^,]+),([^,]+),([^,]+)")
        return true, UDim2.new(tonumber(sx) or 0, tonumber(ox) or 0, tonumber(sy) or 0, tonumber(oy) or 0)
    elseif valueType == "EnumItem" then
        local enumValue = nil
        local okEnum = pcall(function()
            enumValue = loadstring("return " .. rawValue)()
        end)
        if not okEnum or typeof(enumValue) ~= "EnumItem" then
            return false, "Invalid enum item: " .. tostring(rawValue)
        end
        return true, enumValue
    end
    return false, "Unsupported value type: " .. tostring(valueType)
end

local function executeCommand(command)
    if command.type == "status" then
        return true, { connected = true }
    elseif command.type == "list_scripts" then
        local root, err = resolvePath(command.payload.root)
        if not root then
            return false, err
        end
        return true, { scripts = collectScripts(root) }
    elseif command.type == "read_script" then
        local target, err = resolvePath(command.payload.path)
        if not target then
            return false, err
        end
        if not target:IsA("LuaSourceContainer") then
            return false, "Target is not a script: " .. tostring(command.payload.path)
        end
        return true, { path = command.payload.path, source = target.Source }
    elseif command.type == "write_script" then
        local target, err = resolvePath(command.payload.path)
        if not target then
            return false, err
        end
        if not target:IsA("LuaSourceContainer") then
            return false, "Target is not a script: " .. tostring(command.payload.path)
        end
        local previousSource = target.Source
        target.Source = command.payload.source
        return true, { path = command.payload.path, updated = true, previousSource = previousSource }
    elseif command.type == "create_script" then
        local parent, err = resolvePath(command.payload.parentPath)
        if not parent then
            return false, err
        end
        local className = command.payload.scriptType or "Script"
        if className ~= "Script" and className ~= "LocalScript" and className ~= "ModuleScript" then
            return false, "Unsupported script type: " .. tostring(className)
        end
        local newScript = Instance.new(className)
        newScript.Name = command.payload.name
        newScript.Source = command.payload.source or ""
        newScript.Parent = parent
        return true, { path = getPathString(newScript), created = true }
    elseif command.type == "delete_script" then
        local target, err = resolvePath(command.payload.path)
        if not target then
            return false, err
        end
        target:Destroy()
        return true, { path = command.payload.path, deleted = true }
    elseif command.type == "get_selection" then
        local Selection = game:GetService("Selection")
        local selected = {}
        for _, instance in ipairs(Selection:Get()) do
            table.insert(selected, {
                path = getPathString(instance),
                className = instance.ClassName,
                name = instance.Name,
            })
        end
        return true, { selection = selected }
    elseif command.type == "get_instance_tree" then
        local root, err = resolvePath(command.payload.root)
        if not root then
            return false, err
        end
        local maxDepth = tonumber(command.payload.depth) or 3
        local maxNodes = tonumber(command.payload.maxNodes) or 100
        local count = 0
        local function build(instance, depth)
            if count >= maxNodes then
                return nil
            end
            count = count + 1
            local node = {
                path = getPathString(instance),
                name = instance.Name,
                className = instance.ClassName,
            }
            if depth > 0 then
                local children = {}
                for _, child in ipairs(instance:GetChildren()) do
                    local childNode = build(child, depth - 1)
                    if childNode then
                        table.insert(children, childNode)
                    end
                end
                if #children > 0 then
                    node.children = children
                end
            end
            return node
        end
        return true, { root = build(root, maxDepth) }
    elseif command.type == "create_instance" then
        local parent, err = resolvePath(command.payload.parentPath)
        if not parent then
            return false, err
        end
        local ok, newInstance = pcall(function()
            return Instance.new(command.payload.className)
        end)
        if not ok then
            return false, "Unable to create instance: " .. tostring(newInstance)
        end
        newInstance.Name = command.payload.name
        if command.payload.properties then
            for _, property in ipairs(command.payload.properties) do
                local ok, converted = convertPropertyValue(property.type, property.value)
                if not ok then
                    newInstance:Destroy()
                    return false, converted
                end
                local setOk, setError = pcall(function()
                    newInstance[property.name] = converted
                end)
                if not setOk then
                    newInstance:Destroy()
                    return false, "Unable to set property " .. tostring(property.name) .. ": " .. tostring(setError)
                end
            end
        end
        newInstance.Parent = parent
        return true, { path = getPathString(newInstance), created = true }
    elseif command.type == "set_property" then
        local target, err = resolvePath(command.payload.path)
        if not target then
            return false, err
        end
        local valueType = command.payload.valueType
        local rawValue = command.payload.value
        local converted = nil
        if valueType == "string" then
            converted = rawValue
        elseif valueType == "number" then
            converted = tonumber(rawValue)
            if converted == nil then
                return false, "Invalid number: " .. tostring(rawValue)
            end
        elseif valueType == "boolean" then
            if rawValue == "true" then
                converted = true
            elseif rawValue == "false" then
                converted = false
            else
                return false, "Invalid boolean: " .. tostring(rawValue)
            end
        elseif valueType == "Vector3" then
            local x, y, z = rawValue:match("([^,]+),([^,]+),([^,]+)")
            converted = Vector3.new(tonumber(x) or 0, tonumber(y) or 0, tonumber(z) or 0)
        elseif valueType == "Color3" then
            local r, g, b = rawValue:match("([^,]+),([^,]+),([^,]+)")
            converted = Color3.new(tonumber(r) or 0, tonumber(g) or 0, tonumber(b) or 0)
        elseif valueType == "BrickColor" then
            local numberValue = tonumber(rawValue)
            if numberValue then
                converted = BrickColor.new(numberValue)
            else
                converted = BrickColor.new(rawValue)
            end
        elseif valueType == "Instance" then
            local target, err = resolvePath(rawValue)
            if not target then
                return false, err
            end
            converted = target
        elseif valueType == "UDim" then
            local scale, offset = rawValue:match("([^,]+),([^,]+)")
            converted = UDim.new(tonumber(scale) or 0, tonumber(offset) or 0)
        elseif valueType == "UDim2" then
            local sx, ox, sy, oy = rawValue:match("([^,]+),([^,]+),([^,]+),([^,]+)")
            converted = UDim2.new(tonumber(sx) or 0, tonumber(ox) or 0, tonumber(sy) or 0, tonumber(oy) or 0)
        elseif valueType == "EnumItem" then
            local enumValue = nil
            local okEnum = pcall(function()
                enumValue = loadstring("return " .. rawValue)()
            end)
            if not okEnum or typeof(enumValue) ~= "EnumItem" then
                return false, "Invalid enum item: " .. tostring(rawValue)
            end
            converted = enumValue
        else
            return false, "Unsupported value type: " .. tostring(valueType)
        end
        local setOk, setError = pcall(function()
            target[command.payload.propertyName] = converted
        end)
        if not setOk then
            return false, "Unable to set property: " .. tostring(setError)
        end
        return true, {
            path = command.payload.path,
            propertyName = command.payload.propertyName,
            updated = true,
        }
    elseif command.type == "delete_instance" then
        local target, err = resolvePath(command.payload.path)
        if not target then
            return false, err
        end
        target:Destroy()
        return true, { path = command.payload.path, deleted = true }
    elseif command.type == "import_figma" then
        local parent, err = resolvePath(command.payload.parentPath)
        if not parent then
            return false, err
        end
        local createdCount = 0
        local function buildNode(definition, parentNode)
            if type(definition) ~= "table" then
                return nil, "Invalid node definition"
            end
            local newInstance = nil
            local createOk = pcall(function()
                newInstance = Instance.new(definition.className)
            end)
            if not createOk or not newInstance then
                return nil, "Unable to create " .. tostring(definition.className)
            end
            newInstance.Name = definition.name or definition.className
            if type(definition.properties) == "table" then
                for _, property in ipairs(definition.properties) do
                    local ok, converted = convertPropertyValue(property.type, property.value)
                    if ok then
                        pcall(function()
                            newInstance[property.name] = converted
                        end)
                    end
                end
            end
            if type(definition.children) == "table" then
                for _, childDefinition in ipairs(definition.children) do
                    buildNode(childDefinition, newInstance)
                end
            end
            newInstance.Parent = parentNode
            createdCount = createdCount + 1
            return newInstance
        end
        local rootInstance, buildErr = buildNode(command.payload.node, parent)
        if not rootInstance then
            return false, buildErr or "Unable to import Figma node"
        end
        return true, { root = getPathString(rootInstance), created = createdCount }
    elseif command.type == "import_blender" then
        local parent, err = resolvePath(command.payload.parentPath)
        if not parent then
            return false, err
        end
        local scale = tonumber(command.payload.scale) or 1
        local model = Instance.new("Model")
        model.Name = "BlenderImport"
        model.Parent = parent
        local objectMap = {}
        local createdCount = 0
        local objects = command.payload.objects or {}
        for _, objectDefinition in ipairs(objects) do
            local part = Instance.new("Part")
            part.Name = tostring(objectDefinition.name or "BlenderObject")
            local rawSize = objectDefinition.size or { x = 1, y = 1, z = 1 }
            part.Size = Vector3.new(
                (tonumber(rawSize.x) or 1) * scale,
                (tonumber(rawSize.y) or 1) * scale,
                (tonumber(rawSize.z) or 1) * scale
            )
            local rawPosition = objectDefinition.position or { x = 0, y = 0, z = 0 }
            local px = (tonumber(rawPosition.x) or 0) * scale
            local py = (tonumber(rawPosition.y) or 0) * scale
            local pz = (tonumber(rawPosition.z) or 0) * scale
            if type(objectDefinition.rotationMatrix) == "table" and #objectDefinition.rotationMatrix >= 9 then
                local m = objectDefinition.rotationMatrix
                part.CFrame = CFrame.new(
                    px, py, pz,
                    tonumber(m[1]) or 1, tonumber(m[2]) or 0, tonumber(m[3]) or 0,
                    tonumber(m[4]) or 0, tonumber(m[5]) or 1, tonumber(m[6]) or 0,
                    tonumber(m[7]) or 0, tonumber(m[8]) or 0, tonumber(m[9]) or 1
                )
            else
                part.Position = Vector3.new(px, py, pz)
            end
            if type(objectDefinition.color) == "table" then
                part.Color = Color3.new(
                    tonumber(objectDefinition.color[1]) or 1,
                    tonumber(objectDefinition.color[2]) or 1,
                    tonumber(objectDefinition.color[3]) or 1
                )
            end
            local materialName = objectDefinition.material
            if type(materialName) == "string" then
                local materialOk, materialValue = pcall(function()
                    return loadstring("return Enum.Material." .. materialName)()
                end)
                if materialOk and typeof(materialValue) == "EnumItem" then
                    part.Material = materialValue
                end
            end
            if objectDefinition.transparency ~= nil then
                part.Transparency = tonumber(objectDefinition.transparency) or 0
            end
            part.Anchored = true
            part.Parent = model
            objectMap[part.Name] = part
            createdCount = createdCount + 1
        end

        for _, objectDefinition in ipairs(objects) do
            if objectDefinition.parent and objectMap[objectDefinition.name] and objectMap[objectDefinition.parent] then
                objectMap[objectDefinition.name].Parent = objectMap[objectDefinition.parent]
            end
        end

        return true, { root = getPathString(model), created = createdCount }
    elseif command.type == "execute_lua" then
        local fn, compileError = loadstring(command.payload.code)
        if not fn then
            return false, "Compile error: " .. tostring(compileError)
        end
        local ok, result = pcall(fn)
        if not ok then
            return false, "Runtime error: " .. tostring(result)
        end
        return true, { result = tostring(result) }
    end
end

local LogService = game:GetService("LogService")
LogService.MessageOut:Connect(function(message, messageType)
    table.insert(pendingLogs, {
        timestamp = os.time() * 1000,
        message = message,
        messageType = tostring(messageType),
    })
end)

local running = true

local function pollLoop()
    while running do
local heartbeatOk = heartbeat()
        if toolbarButton then
            toolbarButton.Text = heartbeatOk and "OpenStudio Connected" or "OpenStudio Disconnected"
        end
        local ok, result = request("GET", "/commands?token=" .. TOKEN)
        if ok and result and result.commands then
            for _, command in ipairs(result.commands) do
                local success, dataOrError = executeCommand(command)
                request("POST", "/result", {
                    id = command.id,
                    ok = success,
                    data = success and dataOrError or nil,
                    error = (not success) and tostring(dataOrError) or nil,
                })
            end
        end
        task.wait(1)
    end
end

if Plugin then
    local toolbar = Plugin:CreateToolbar("OpenStudio")
    local button = toolbar:CreateButton("Connect", "Toggle OpenStudio connection", "")`r`n    toolbarButton = button
    button.Click:Connect(function()
        if running then
            running = false
            button.Text = "Disconnected"
        else
            running = true
            button.Text = "Connected"
            task.spawn(pollLoop)
        end
    end)
    task.spawn(pollLoop)
else
    task.spawn(pollLoop)
end
