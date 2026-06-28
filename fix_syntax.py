import re

with open('dashboard/src/v2/ChatPage.tsx', 'r') as f:
    content = f.read()

# Let's fix the invocations view close tag error
# The syntax error was from:
#           )}
#         </div>
#         </div>
#       );
#     }
#   };

old_code = """          )}
        </div>
        </div>
      );
    }
  };"""

new_code = """          )}
        </div>
        </div>
      </>
      );
    }
  };"""

content = content.replace(old_code, new_code)
with open('dashboard/src/v2/ChatPage.tsx', 'w') as f:
    f.write(content)
