from django.contrib import admin

from questlines.models import Objective, Quest, Questline

admin.site.register(Questline)
admin.site.register(Quest)
admin.site.register(Objective)
