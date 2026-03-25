import re

with open("src/services/quicksprint-service.ts", "r") as f:
    content = f.read()

content = content.replace("model: input.modelOverride,", "virtualModel: input.modelOverride,")

with open("src/services/quicksprint-service.ts", "w") as f:
    f.write(content)
