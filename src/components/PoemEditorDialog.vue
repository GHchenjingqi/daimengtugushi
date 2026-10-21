<script setup>
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: { type: Boolean, default: false },
  poem: { type: Object, default: null }, // null => 新增
  tagSuggestions: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:visible', 'save'])

const form = ref({
  title: '',
  author: '',
  dynasty: '',
  contentText: '',
  tags: [],
  translation: '',
  notes: ''
})
const formRef = ref(null)
const isEdit = computed(() => !!props.poem)

const dynastyOptions = ['唐', '宋', '元', '明', '清', '南北朝', '先秦', '汉', '五代', '其他']

const rules = {
  title: [{ required: true, message: '请输入诗词标题', trigger: 'blur' }],
  author: [{ required: true, message: '请输入作者', trigger: 'blur' }]
}

watch(
  () => [props.visible, props.poem],
  () => {
    if (!props.visible) return
    if (props.poem) {
      form.value = {
        title: props.poem.title,
        author: props.poem.author,
        dynasty: props.poem.dynasty || '',
        contentText: (props.poem.content || []).join('\n'),
        tags: [...(props.poem.tags || [])],
        translation: props.poem.translation || '',
        notes: props.poem.notes || ''
      }
    } else {
      form.value = {
        title: '',
        author: '',
        dynasty: '',
        contentText: '',
        tags: [],
        translation: '',
        notes: ''
      }
    }
    formRef.value?.clearValidate?.()
  },
  { immediate: true }
)

function buildPayload() {
  return {
    title: form.value.title,
    author: form.value.author,
    dynasty: form.value.dynasty,
    content: form.value.contentText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    tags: form.value.tags.map((t) => String(t).trim()).filter(Boolean),
    translation: form.value.translation,
    notes: form.value.notes
  }
}

function onSave() {
  formRef.value.validate((valid) => {
    if (!valid) return
    if (!buildPayload().content.length) {
      ElMessage.warning('正文不能为空')
      return
    }
    emit('save', { id: props.poem?.id, payload: buildPayload() })
  })
}

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="emit('update:visible', $event)"
    :title="isEdit ? '编辑诗词' : '添加诗词'"
    width="640px"
    top="5vh"
    @close="close"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
      <el-form-item label="标题" prop="title">
        <el-input v-model="form.title" placeholder="如：静夜思" maxlength="40" />
      </el-form-item>
      <el-form-item label="作者" prop="author">
        <el-input v-model="form.author" placeholder="如：李白" maxlength="20" />
      </el-form-item>
      <el-form-item label="朝代">
        <el-select
          v-model="form.dynasty"
          placeholder="选择或输入"
          filterable
          allow-create
          default-first-option
          style="width: 200px"
        >
          <el-option v-for="d in dynastyOptions" :key="d" :label="d" :value="d" />
        </el-select>
      </el-form-item>
      <el-form-item label="正文">
        <el-input
          v-model="form.contentText"
          type="textarea"
          :rows="6"
          placeholder="每行一句，逐行输入。例如：&#10;床前明月光，疑是地上霜。&#10;举头望明月，低头思故乡。"
        />
      </el-form-item>
      <el-form-item label="标签">
        <el-select
          v-model="form.tags"
          multiple
          filterable
          allow-create
          default-first-option
          placeholder="输入后回车添加，可重复归类"
          style="width: 100%"
        >
          <el-option v-for="t in tagSuggestions" :key="t" :label="t" :value="t" />
        </el-select>
        <div class="form-hint">标签可重复：同一首诗可同时属于「唐诗」「中小学必备古诗」等多个分类。</div>
      </el-form-item>
      <el-form-item label="译文">
        <el-input v-model="form.translation" type="textarea" :rows="3" placeholder="选填" />
      </el-form-item>
      <el-form-item label="注释">
        <el-input v-model="form.notes" type="textarea" :rows="2" placeholder="选填" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="onSave">{{ isEdit ? '保存' : '添加' }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint {
  font-size: 12px;
  color: #9b8e76;
  margin-top: 4px;
  line-height: 1.5;
}
</style>
